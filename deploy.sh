#!/usr/bin/env bash
set -euo pipefail

# Run only when you intend to provision or update AWS resources.
for tool in terraform ansible-playbook; do
    command -v "$tool" >/dev/null || { echo "$tool is required before deployment." >&2; exit 1; }
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test -f "$SCRIPT_DIR/.env" || { echo "Create .env with production settings and a strong JWT_SECRET first." >&2; exit 1; }

# Terraform uses AWS environment credentials, profiles, or instance roles.
# Never pass secret values through command-line arguments.
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION
cd "$SCRIPT_DIR/terraform"
terraform init
terraform apply -auto-approve -var="aws_region=$AWS_REGION"
EC2_IP=$(terraform output -raw ec2_public_ip)
chmod 600 "$SCRIPT_DIR/terraform/ec2_key.pem"

cd "$SCRIPT_DIR/ansible"
# The playbook waits for SSH readiness before configuring the instance.
ansible-playbook -i inventory.ini playbook.yml
echo "Deployment complete: http://$EC2_IP"
