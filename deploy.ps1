# Run this script only when you intend to provision or update AWS resources.
Param(
    [string]$AwsRegion = "us-east-1",
    [string]$AwsAccessKey = $env:AWS_ACCESS_KEY_ID,
    [string]$AwsSecretKey = $env:AWS_SECRET_ACCESS_KEY
)
$ErrorActionPreference = "Stop"
foreach ($tool in @("terraform", "ansible-playbook")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required before deployment. On Windows, use WSL with deploy.sh for Ansible."
    }
}
if (-not (Test-Path -LiteralPath "$PSScriptRoot/.env")) {
    throw "Create .env with production settings and a strong JWT_SECRET before deployment."
}
# Credentials can also come from AWS profiles or an instance role.
if ($AwsAccessKey) { $env:AWS_ACCESS_KEY_ID = $AwsAccessKey }
if ($AwsSecretKey) { $env:AWS_SECRET_ACCESS_KEY = $AwsSecretKey }
$env:AWS_DEFAULT_REGION = $AwsRegion

Push-Location $PSScriptRoot
try {
    Set-Location -LiteralPath "$PSScriptRoot/terraform"
    terraform init
    if ($LASTEXITCODE -ne 0) { throw "Terraform init failed." }
    terraform apply -auto-approve "-var=aws_region=$AwsRegion"
    if ($LASTEXITCODE -ne 0) { throw "Terraform apply failed." }
    $Ec2PublicIp = terraform output -raw ec2_public_ip
    if ($LASTEXITCODE -ne 0) { throw "Could not read the EC2 address." }

    Set-Location -LiteralPath "$PSScriptRoot/ansible"
    ansible-playbook -i inventory.ini playbook.yml
    if ($LASTEXITCODE -ne 0) { throw "Ansible deployment failed." }
    Write-Host "Deployment complete: http://$Ec2PublicIp"
} finally {
    Pop-Location
}
