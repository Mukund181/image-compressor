#!/usr/bin/env bash
set -e

echo "=================================================="
echo "🚀 OptiCompress DevOps Automated Deployment Pipeline"
echo "=================================================="

# Check AWS Credentials
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "⚠️  AWS credentials not detected in environment."
    read -p "Enter AWS Access Key ID: " AWS_ACCESS_KEY_ID
    read -p "Enter AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
    export AWS_ACCESS_KEY_ID
    export AWS_SECRET_ACCESS_KEY
fi

AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Terraform
echo ""
echo "📦 [1/3] Provisioning AWS EC2 Infrastructure via Terraform..."
cd "$SCRIPT_DIR/terraform"

terraform init
terraform apply -auto-approve \
  -var="aws_region=$AWS_REGION" \
  -var="aws_access_key=$AWS_ACCESS_KEY_ID" \
  -var="aws_secret_key=$AWS_SECRET_ACCESS_KEY"

EC2_IP=$(terraform output -raw ec2_public_ip)

echo ""
echo "✅ EC2 Instance Provisioned! Public IP: $EC2_IP"

# Step 2: Ansible
echo ""
echo "⚙️  [2/3] Configuring Server & Deploying Docker Container via Ansible..."
cd "$SCRIPT_DIR/ansible"

# Fix SSH key permissions
chmod 600 "$SCRIPT_DIR/terraform/ec2_key.pem" || true

# Wait 15 seconds for SSH to become ready on AWS
echo "Waiting for SSH connection to become ready..."
sleep 15

ansible-playbook -i inventory.ini playbook.yml

echo ""
echo "=================================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "Application URL: http://$EC2_IP"
echo "SSH Access: ssh -i $SCRIPT_DIR/terraform/ec2_key.pem ubuntu@$EC2_IP"
echo "=================================================="
