variable "servicebus_sku" {
  description = "Service Bus SKU. Basic (queues only, pay-per-operation) is used to avoid the ~USD 10/month Standard base charge."
  type        = string
  default     = "Basic"
}

data "azurerm_client_config" "current" {}

resource "azurerm_servicebus_namespace" "main" {
  name                = "${local.name_prefix}-sb-${random_string.suffix.result}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = var.servicebus_sku

  # Entra ID (RBAC) only: no shared-access keys or connection strings.
  local_auth_enabled = false
  tags               = local.common_tags
}

resource "azurerm_servicebus_queue" "booking_requests" {
  name         = "booking-requests"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count = 5
  lock_duration      = "PT1M"
}

# Least privilege for the signed-in developer running the API locally.
resource "azurerm_role_assignment" "dev_sb_sender" {
  scope                = azurerm_servicebus_namespace.main.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "dev_sb_receiver" {
  scope                = azurerm_servicebus_namespace.main.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = data.azurerm_client_config.current.object_id
}

output "servicebus_namespace" {
  description = "Service Bus fully qualified namespace."
  value       = "${azurerm_servicebus_namespace.main.name}.servicebus.windows.net"
}

# Needed only so the API can read queue depth (management plane). Dev user only.
resource "azurerm_role_assignment" "dev_sb_owner" {
  scope                = azurerm_servicebus_namespace.main.id
  role_definition_name = "Azure Service Bus Data Owner"
  principal_id         = data.azurerm_client_config.current.object_id
}
