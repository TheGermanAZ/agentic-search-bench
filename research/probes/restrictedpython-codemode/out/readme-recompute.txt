=== 0c8e3c4_claude.json
summary key: {
 "regular_agent": {
  "total_tests": 8,
  "successful_tests": 5,
  "validated_tests": 6,
  "validation_passed": 6,
  "validation_rate": 1.0,
  "avg_execution_time": 10.211808347702027,
  "avg_iterations": 7.2,
  "total_input_tokens": 93024,
  "total_output_tokens": 3694,
  "avg_input_tokens": 18604.8,
  "avg_output_tokens": 738.8
 },
 "codemode_agent": {
  "total_tests": 8,
  "successful_tests": 5,
  "validated_tests": 5,
  "validation_passed": 5,
  "validation_rate": 1.0,
  "avg_execution_time": 4.254240942001343,
  "avg_iterations": 1.0,
  "total_input_tokens": 30015,
  "total_output_tokens": 2309,
  "avg_input_tokens": 6003.0,
  "avg_output_tokens": 461.8
 }
}
regular_agent: scenarios=8 success=5/8
  per scenario (id, success, in, out, iterations, time):
    1 True 14297 693 6 8.75 
    2 True 12168 538 5 6.96 
    3 True 18119 613 7 9.3 
    4 True 24915 1056 9 13.58 
    5 True 23525 794 9 12.47 
    6 False None None 20 33.14 Max iterations reached
    7 False None None None 4.3 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
    8 False None None None 3.18 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
  tokens over successful scenarios: 96718
  tokens over all scenarios: 96718
codemode_agent: scenarios=8 success=5/8
  per scenario (id, success, in, out, iterations, time):
    1 True 5956 257 1 2.8 
    2 True 6022 518 1 5.64 
    3 True 6010 638 1 5.16 
    4 True 6012 344 1 2.96 
    5 True 6015 552 1 4.72 
    6 False None None None 2.23 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
    7 False None None None 2.09 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
    8 False None None None 1.88 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
  tokens over successful scenarios: 32324
  tokens over all scenarios: 32324
=== 917128b_claude.json
summary key: {
 "regular_agent": {
  "total_tests": 8,
  "successful_tests": 6,
  "validated_tests": 7,
  "validation_passed": 7,
  "validation_rate": 1.0,
  "avg_execution_time": 11.881252805391947,
  "avg_iterations": 8.0,
  "total_input_tokens": 139191,
  "total_output_tokens": 5059,
  "avg_input_tokens": 23198.5,
  "avg_output_tokens": 843.1666666666666
 },
 "codemode_agent": {
  "total_tests": 8,
  "successful_tests": 7,
  "validated_tests": 7,
  "validation_passed": 7,
  "validation_rate": 1.0,
  "avg_execution_time": 4.710224866867065,
  "avg_iterations": 1.0,
  "total_input_tokens": 42180,
  "total_output_tokens": 3561,
  "avg_input_tokens": 6025.714285714285,
  "avg_output_tokens": 508.7142857142857
 }
}
regular_agent: scenarios=8 success=6/8
  per scenario (id, success, in, out, iterations, time):
    1 True 14298 657 6 8.68 
    2 True 12168 475 5 6.29 
    3 True 15099 551 6 8.09 
    4 True 24879 1178 9 14.09 
    5 True 14480 658 6 8.4 
    6 False None None 20 34.98 Max iterations reached
    7 True 58267 1540 16 25.73 
    8 False None None None 24.28 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
  tokens over successful scenarios: 144250
  tokens over all scenarios: 144250
codemode_agent: scenarios=8 success=7/8
  per scenario (id, success, in, out, iterations, time):
    1 True 5956 216 1 2.13 
    2 True 6022 412 1 3.44 
    3 True 6010 476 1 4.51 
    4 True 6012 341 1 3.12 
    5 True 6015 748 1 6.49 
    6 False None None None 19.92 Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', 'messa
    7 True 6107 627 1 5.02 
    8 True 6058 741 1 8.26 
  tokens over successful scenarios: 45741
  tokens over all scenarios: 45741
=== 0c8e3c4_gemini.json
summary key: {
 "regular_agent": {
  "total_tests": 2,
  "successful_tests": 0,
  "validated_tests": 0,
  "validation_passed": 0,
  "validation_rate": 0
 },
 "codemode_agent": {
  "total_tests": 2,
  "successful_tests": 0,
  "validated_tests": 2,
  "validation_passed": 0,
  "validation_rate": 0
 }
}
regular_agent: scenarios=2 success=0/2
  per scenario (id, success, in, out, iterations, time):
    1 False None None None 0.0 'object'
    2 False None None None 0.0 'object'
  tokens over successful scenarios: 0
  tokens over all scenarios: 0
codemode_agent: scenarios=2 success=0/2
  per scenario (id, success, in, out, iterations, time):
    1 False 0 0 1 0.19 404 models/gemini-1.5-pro-latest is not found for API version v1beta, or is not 
    2 False 0 0 1 0.13 404 models/gemini-1.5-pro-latest is not found for API version v1beta, or is not 
  tokens over successful scenarios: 0
  tokens over all scenarios: 0
=== 917128b_gemini.json
summary key: {
 "regular_agent": {
  "total_tests": 8,
  "successful_tests": 5,
  "validated_tests": 8,
  "validation_passed": 4,
  "validation_rate": 0.5,
  "avg_execution_time": 5.067400979995727,
  "avg_iterations": 3.4,
  "total_input_tokens": 17294,
  "total_output_tokens": 1496,
  "avg_input_tokens": 3458.8,
  "avg_output_tokens": 299.2
 },
 "codemode_agent": {
  "total_tests": 8,
  "successful_tests": 5,
  "validated_tests": 8,
  "validation_passed": 6,
  "validation_rate": 0.75,
  "avg_execution_time": 4.300750827789306,
  "avg_iterations": 1.0,
  "total_input_tokens": 27545,
  "total_output_tokens": 3079,
  "avg_input_tokens": 5509.0,
  "avg_output_tokens": 615.8
 }
}
regular_agent: scenarios=8 success=5/8
  per scenario (id, success, in, out, iterations, time):
    1 True 1931 156 2 2.66 
    2 True 1485 85 2 2.02 
    3 True 4354 445 5 7.13 
    4 False 0 0 0 0.15 429 You exceeded your current quota, please check your plan and billing details.
    5 False 0 0 0 0.13 429 You exceeded your current quota, please check your plan and billing details.
    6 False 0 0 0 0.17 429 You exceeded your current quota, please check your plan and billing details.
    7 True 6475 422 6 8.21 
    8 True 3049 388 2 5.31 
  tokens over successful scenarios: 18790
  tokens over all scenarios: 18790
codemode_agent: scenarios=8 success=5/8
  per scenario (id, success, in, out, iterations, time):
    1 True 5423 290 1 2.93 
    2 True 5487 489 1 3.82 
    3 False 0 0 1 0.18 429 You exceeded your current quota, please check your plan and billing details.
    4 True 5481 554 1 3.8 
    5 False 0 0 1 0.2 429 You exceeded your current quota, please check your plan and billing details.
    6 True 5586 944 1 5.89 
    7 True 5568 802 1 5.07 
    8 False 11715 1193 3 8.68 429 You exceeded your current quota, please check your plan and billing details.
  tokens over successful scenarios: 30624
  tokens over all scenarios: 43532
regular_agent 1 True {"valid": true, "scenario_id": 1, "scenario_name": "Monthly Expense Recording", "checks": [{"check": "Minimum 4 transactions", "expected": ">= 4", "ac
regular_agent 2 True {"valid": true, "scenario_id": 2, "scenario_name": "Client Invoicing Workflow", "checks": [{"check": "Minimum 2 invoices", "expected": ">= 2", "actual
regular_agent 3 True {"valid": true, "scenario_id": 3, "scenario_name": "Payment Processing and Reconciliation", "checks": [{"check": "Minimum 2 transactions", "expected":
regular_agent 4 True {"valid": true, "scenario_id": 4, "scenario_name": "Mixed Income and Expense Tracking", "checks": [{"check": "Minimum 7 transactions", "expected": ">=
regular_agent 5 True {"valid": true, "scenario_id": 5, "scenario_name": "Multi-Account Fund Management", "checks": [{"check": "Minimum 6 transactions", "expected": ">= 6",
regular_agent 6 False {"valid": true, "scenario_id": 6, "scenario_name": "Quarter-End Financial Analysis", "checks": [{"check": "Minimum 12 transactions", "expected": ">= 1
regular_agent 7 True {"valid": true, "scenario_id": 7, "scenario_name": "Complex Multi-Client Invoice Management", "checks": [{"check": "Minimum 3 invoices", "expected": "
regular_agent 8 False null
codemode_agent 1 True {"valid": true, "scenario_id": 1, "scenario_name": "Monthly Expense Recording", "checks": [{"check": "Minimum 4 transactions", "expected": ">= 4", "ac
codemode_agent 2 True {"valid": true, "scenario_id": 2, "scenario_name": "Client Invoicing Workflow", "checks": [{"check": "Minimum 2 invoices", "expected": ">= 2", "actual
codemode_agent 3 True {"valid": true, "scenario_id": 3, "scenario_name": "Payment Processing and Reconciliation", "checks": [{"check": "Minimum 2 transactions", "expected":
codemode_agent 4 True {"valid": true, "scenario_id": 4, "scenario_name": "Mixed Income and Expense Tracking", "checks": [{"check": "Minimum 7 transactions", "expected": ">=
codemode_agent 5 True {"valid": true, "scenario_id": 5, "scenario_name": "Multi-Account Fund Management", "checks": [{"check": "Minimum 6 transactions", "expected": ">= 6",
codemode_agent 6 False null
codemode_agent 7 True {"valid": true, "scenario_id": 7, "scenario_name": "Complex Multi-Client Invoice Management", "checks": [{"check": "Minimum 3 invoices", "expected": "
codemode_agent 8 True {"valid": true, "scenario_id": 8, "scenario_name": "Budget Tracking and Category Analysis", "checks": [{"check": "Minimum 14 transactions", "expected"
matched scenarios [1, 2, 3, 4, 5, 7] regular 144250 codemode 38942 savings 73.0%
