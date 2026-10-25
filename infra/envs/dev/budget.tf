variable "budget_alert_email" {
  description = "Email address that receives budget alerts."
  type        = string
}

variable "monthly_budget_amount" {
  description = "Monthly subscription budget in the billing currency."
  type        = number
  default     = 5
}

resource "azurerm_consumption_budget_subscription" "monthly" {
  name            = "${local.name_prefix}-monthly-budget"
  subscription_id = "/subscriptions/${var.subscription_id}"

  amount     = var.monthly_budget_amount
  time_grain = "Monthly"

  time_period {
    start_date = "2026-10-01T00:00:00Z"
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = [var.budget_alert_email]
  }
}
