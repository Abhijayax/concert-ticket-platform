variable "subscription_id" {
  description = "Azure subscription ID used for this environment."
  type        = string
}

variable "location" {
  description = "Azure region for the development environment."
  type        = string
  default     = "indiasouthcentral"
}

variable "project_name" {
  description = "Short project identifier used in Azure resource names."
  type        = string
  default     = "concertticket"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
}

variable "cosmos_consistency_level" {
  description = "Default Cosmos DB consistency level."
  type        = string
  default     = "Session"

  validation {
    condition = contains([
      "Strong",
      "BoundedStaleness",
      "Session",
      "ConsistentPrefix",
      "Eventual"
    ], var.cosmos_consistency_level)

    error_message = "Choose a valid Cosmos DB consistency level."
  }
}
