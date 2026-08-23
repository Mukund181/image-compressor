output "ec2_public_ip" {
  description = "Public IP address of the provisioned AWS EC2 instance"
  value       = aws_instance.web_server.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS of the EC2 instance"
  value       = aws_instance.web_server.public_dns
}

output "ssh_command" {
  description = "Command to SSH directly into the EC2 instance"
  value       = "ssh -i terraform/ec2_key.pem ubuntu@${aws_instance.web_server.public_ip}"
}

output "application_url" {
  description = "URL to access the Image Compressor app"
  value       = "http://${aws_instance.web_server.public_ip}"
}
