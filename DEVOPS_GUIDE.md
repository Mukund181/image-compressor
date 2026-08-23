# OptiCompress DevOps Guide: Docker, Terraform, Ansible & GitHub Actions (AWS EC2)

This guide provides step-by-step instructions to deploy the **OptiCompress** Node.js Image Compressor app onto **AWS EC2** using **Terraform**, **Ansible**, **Docker**, and **GitHub Actions**.

---

## 🛠️ DevOps Architecture Overview

```
 ┌────────────────┐     Push      ┌─────────────────┐     Pull      ┌────────────────┐
 │ Developer Code │ ───────────>  │   GitHub Hub    │ ────────────> │ AWS EC2 Host   │
 │   (Git Repo)   │               │ & Docker Hub    │               │ (Ubuntu 22.04) │
 └────────────────┘               └─────────────────┘               └────────────────┘
                                           │                                 │
                                    Triggers CI/CD                   Docker Container
                                           │                          (Port 80 -> 3000)
                                           ▼                                 ▲
                                  ┌─────────────────┐                        │
                                  │ Terraform (IaC) │ ──── Provision ────────┘
                                  │ Ansible (Config)│ ──── Deploy ───────────┘
                                  └─────────────────┘
```

- **Docker Username**: `mukund181`
- **Docker Image**: `mukund181/image-compressor:latest`
- **GitHub Username**: `mukund181`

---

## 🚀 Option 1: Automated One-Click Deployment (Recommended)

### On Windows (PowerShell):
Set your AWS Credentials in PowerShell and run the deployment script:

```powershell
$env:AWS_ACCESS_KEY_ID="YOUR_ACTUAL_AWS_ACCESS_KEY"
$env:AWS_SECRET_ACCESS_KEY="YOUR_ACTUAL_AWS_SECRET_KEY"
$env:AWS_REGION="us-east-1"  # Or ap-south-1, etc.

.\deploy.ps1
```

### On WSL / Linux / macOS (Bash):
```bash
export AWS_ACCESS_KEY_ID="YOUR_ACTUAL_AWS_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="YOUR_ACTUAL_AWS_SECRET_KEY"
export AWS_REGION="us-east-1"

chmod +x deploy.sh
./deploy.sh
```

---

## 📦 Option 2: Step-by-Step Manual DevOps Execution

If you prefer to run each DevOps tool manually, follow these 4 steps:

### Step 1: Docker Build & Push (Local / Docker Hub)

Log into Docker Hub and push your container image:

```bash
# 1. Login to Docker Hub
docker login -u mukund181

# 2. Build the Docker image
docker build -t mukund181/image-compressor:latest .

# 3. Push to Docker Hub
docker push mukund181/image-compressor:latest
```

---

### Step 2: Provision AWS EC2 Infrastructure (Terraform)

Navigate to the `terraform/` directory:

```bash
cd terraform

# 1. Initialize Terraform
terraform init

# 2. Create terraform.tfvars file with your AWS credentials
cat <<EOF > terraform.tfvars
aws_region     = "us-east-1"
aws_access_key = "YOUR_AWS_ACCESS_KEY"
aws_secret_key = "YOUR_AWS_SECRET_KEY"
EOF

# 3. Apply infrastructure plan
terraform apply -auto-approve
```

> **Outputs generated:**
> - `ec2_public_ip`: Public IP of the created server.
> - `ec2_key.pem`: SSH key generated automatically to connect to EC2.
> - `../ansible/inventory.ini`: Generated inventory for Ansible automatically!

---

### Step 3: Server Configuration & App Deployment (Ansible)

Navigate to the `ansible/` directory:

```bash
cd ../ansible

# 1. Run Ansible playbook to install Docker and run the image-compressor container
ansible-playbook -i inventory.ini playbook.yml
```

Once completed, your app will be live at:
`http://<YOUR_EC2_PUBLIC_IP>`

---

### Step 4: GitHub Actions CI/CD Pipeline Setup

To automatically build and deploy new code updates every time you `git push` to GitHub:

1. **Create GitHub Repository**:
   Create a new repo on GitHub named `image-compressor` under user `mukund181`.

2. **Add GitHub Repository Secrets**:
   In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add:

   | Secret Name | Value Description |
   | :--- | :--- |
   | `DOCKERHUB_USERNAME` | `mukund181` |
   | `DOCKERHUB_TOKEN` | Your Docker Hub Access Token / Password |
   | `EC2_HOST` | *(Optional)* The Public IP of your EC2 instance |
   | `EC2_SSH_KEY` | *(Optional)* Content of `terraform/ec2_key.pem` |

3. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - OptiCompress DevOps app"
   git branch -M main
   git remote add origin https://github.com/mukund181/image-compressor.git
   git push -u origin main
   ```

   GitHub Actions will automatically trigger `.github/workflows/deploy.yml` to build the Docker image and push to Docker Hub!

---

## 🔑 Useful Commands Quick Reference

- **SSH into your EC2 Instance**:
  ```bash
  ssh -i terraform/ec2_key.pem ubuntu@<EC2_PUBLIC_IP>
  ```

- **View Live Container Logs on EC2**:
  ```bash
  sudo docker logs -f image-compressor-app
  ```

- **Destroy AWS Resources (Clean up when finished)**:
  ```bash
  cd terraform
  terraform destroy -auto-approve
  ```
