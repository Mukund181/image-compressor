variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for deployment (e.g. us-east-1, ap-south-1, eu-west-1)"
}

variable "aws_access_key" {
  type        = string
  default     = ""
  description = "AWS Access Key ID (Leave empty if using AWS CLI / Env vars)"
  sensitive   = true
}

variable "aws_secret_key" {
  type        = string
  default     = ""
  description = "AWS Secret Access Key (Leave empty if using AWS CLI / Env vars)"
  sensitive   = true
}

variable "instance_type" {
  type        = string
  default     = "t3.micro"
  description = "EC2 Instance type (Free Tier eligible in ap-south-1: t3.micro)"
}

variable "key_name" {
  type        = string
  default     = "image-compressor-key"
  description = "Name of the SSH Key Pair to generate and register on AWS"
}

variable "app_name" {
  type        = string
  default     = "image-compressor"
  description = "Application name tag"
}
