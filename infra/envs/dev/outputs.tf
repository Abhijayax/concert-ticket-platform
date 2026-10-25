output "resource_group_name" {
  description = "Development resource group."
  value       = azurerm_resource_group.main.name
}

output "cosmos_account_name" {
  description = "Cosmos DB account name."
  value       = azurerm_cosmosdb_account.main.name
}

output "cosmos_endpoint" {
  description = "Cosmos DB endpoint URL."
  value       = azurerm_cosmosdb_account.main.endpoint
}

output "cosmos_database_name" {
  description = "Cosmos DB database name."
  value       = azurerm_cosmosdb_sql_database.ticketing.name
}

output "cosmos_container_names" {
  description = "Names of the Cosmos DB containers."
  value = {
    events   = azurerm_cosmosdb_sql_container.events.name
    seats    = azurerm_cosmosdb_sql_container.seats.name
    bookings = azurerm_cosmosdb_sql_container.bookings.name
  }
}
