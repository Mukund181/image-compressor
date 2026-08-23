# Automated Deployment Script for Windows (PowerShell)
Param(
    [string]$AwsRegion = "us-east-1",
    [string]$AwsAccessKey = $env:AWS_ACCESS_KEY_ID,
    [string]$AwsSecretKey = $env:AWS_SECRET_ACCESS_KEY
)

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 OptiCompress DevOps Automated Deployment Pipeline" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Step 1: Check AWS Credentials
if (-not $AwsAccessKey -or -not $AwsSecretKey) {
    Write-Host "⚠️  AWS Access Key or Secret Key environment variables are missing." -ForegroundColor Yellow
    Write-Host "Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or enter them below:" -ForegroundColor Yellow
    if (-not $AwsAccessKey) { $AwsAccessKey = Read-Host "Enter AWS_ACCESS_KEY_ID" }
    if (-not $AwsSecretKey) { $AwsSecretKey = Read-Host "Enter AWS_SECRET_ACCESS_KEY" }
}

$env:AWS_ACCESS_KEY_ID = $AwsAccessKey
$env:AWS_SECRET_ACCESS_KEY = $AwsSecretKey
$env:AWS_DEFAULT_REGION = $AwsRegion

# Step 2: Terraform Infrastructure Provisioning
Write-Host "`n📦 [1/3] Provisioning AWS EC2 Infrastructure with Terraform..." -ForegroundColor Green
Set-Location "$PSScriptRoot/terraform"

terraform init
terraform apply -auto-approve -var="aws_region=$AwsRegion" -var="aws_access_key=$AwsAccessKey" -var="aws_secret_key=$AwsSecretKey"

$Ec2PublicIp = (terraform output -raw ec2_public_ip)
$SshCommand = (terraform output -raw ssh_command)

Write-Host "`n✅ EC2 Instance Provisioned Successfully!" -ForegroundColor Green
Write-Host "Public IP: $Ec2PublicIp" -ForegroundColor Yellow

# Step 3: Run Ansible Playbook
Write-Host "`n⚙️  [2/3] Configuring Server & Deploying Docker Container with Ansible..." -ForegroundColor Green
Set-Location "$PSScriptRoot/ansible"

# Ensure Inventory is ready
if (Test-Path "$PSScriptRoot/ansible/inventory.ini") {
    Write-Host "Running Ansible Playbook..." -ForegroundColor Gray
    ansible-playbook -i inventory.ini playbook.yml
} else {
    Write-Host "⚠️  Ansible inventory file not found. If running on Windows without Ansible installed," -ForegroundColor Yellow
    Write-Host "You can SSH directly into EC2 and run docker compose:" -ForegroundColor Yellow
    Write-Host "$SshCommand" -ForegroundColor Cyan
}

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "🎉 DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "Application URL: http://$Ec2PublicIp" -ForegroundColor Cyan
Write-Host "SSH Access: $SshCommand" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

Set-Location "$PSScriptRoot"
