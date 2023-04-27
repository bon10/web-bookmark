resource "aws_api_gateway_rest_api" "this" {
  name        = var.api_name
  description = var.api_description
}

variable "api_name" {
  type = string
}

variable "api_description" {
  type = string
}
