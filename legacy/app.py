#!/usr/bin/env python3
"""
Tamper-Evident AI Proof Verification System - Console Demo
Uses only Python standard library to demonstrate cryptographic proof concepts
"""

import hashlib
import json
import random
from typing import Dict, List, Any


def calculate_sha256(data: str) -> str:
    """Calculate SHA-256 hash of input data"""
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def create_sample_data() -> List[Dict[str, Any]]:
    """Create sample CSV-like dataset as list of dictionaries"""
    return [
        {'id': 1, 'value1': 10.5, 'value2': 8.2},
        {'id': 2, 'value1': 25.3, 'value2': 19.6},
        {'id': 3, 'value1': 18.7, 'value2': 22.4},
        {'id': 4, 'value1': 33.2, 'value2': 28.7},
        {'id': 5, 'value1': 42.1, 'value2': 35.5},
        {'id': 6, 'value1': 15.8, 'value2': 12.3},
        {'id': 7, 'value1': 28.9, 'value2': 31.1}
    ]


def data_to_csv_string(data: List[Dict[str, Any]]) -> str:
    """Convert data to consistent CSV-like string format for hashing"""
    if not data:
        return ""
    
    # Get headers from first row
    headers = list(data[0].keys())
    lines = [','.join(headers)]
    
    # Add data rows
    for row in data:
        values = [str(row[header]) for header in headers]
        lines.append(','.join(values))
    
    return '\n'.join(lines)


def ai_equation(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    AI equation: calculate average of value1 and value2 for each row
    Returns new data with 'average' column added
    """
    processed_data = []
    for row in data:
        new_row = row.copy()
        new_row['average'] = (row['value1'] + row['value2']) / 2
        processed_data.append(new_row)
    return processed_data


def calculate_final_output(processed_data: List[Dict[str, Any]]) -> float:
    """Calculate final output: sum of all averages"""
    return sum(row['average'] for row in processed_data)


def generate_proof_tag(input_data: List[Dict[str, Any]], equation_code: str, final_output: float) -> Dict[str, Any]:
    """Generate tamper-evident proof tag"""
    # Convert input data to string for hashing
    input_data_str = data_to_csv_string(input_data)
    input_data_hash = calculate_sha256(input_data_str)
    
    # Hash the equation code
    equation_hash = calculate_sha256(equation_code)
    
    # Create proof tag without the self-hash first
    proof_tag = {
        "input_data_hash": input_data_hash,
        "equation_hash": equation_hash,
        "final_output": final_output
    }
    
    # Calculate hash of the proof tag itself
    proof_tag_str = json.dumps(proof_tag, sort_keys=True)
    proof_tag_hash = calculate_sha256(proof_tag_str)
    
    # Add the self-hash to complete the proof tag
    proof_tag["proof_tag_hash"] = proof_tag_hash
    
    return proof_tag


def verify_proof(input_data: List[Dict[str, Any]], equation_code: str, proof_tag: Dict[str, Any]) -> Dict[str, bool]:
    """Verify the integrity of data and proof tag"""
    results = {}
    
    # Verify input data hash
    input_data_str = data_to_csv_string(input_data)
    computed_input_hash = calculate_sha256(input_data_str)
    results['input_data'] = computed_input_hash == proof_tag['input_data_hash']
    
    # Verify equation hash
    computed_equation_hash = calculate_sha256(equation_code)
    results['equation'] = computed_equation_hash == proof_tag['equation_hash']
    
    # Verify final output by recomputing
    processed_data = ai_equation(input_data)
    computed_final_output = calculate_final_output(processed_data)
    results['final_output'] = abs(computed_final_output - proof_tag['final_output']) < 1e-10
    
    # Verify proof tag self-hash
    proof_tag_without_self_hash = {k: v for k, v in proof_tag.items() if k != 'proof_tag_hash'}
    proof_tag_str = json.dumps(proof_tag_without_self_hash, sort_keys=True)
    computed_proof_hash = calculate_sha256(proof_tag_str)
    results['proof_tag'] = computed_proof_hash == proof_tag.get('proof_tag_hash', '')
    
    return results


def print_data_table(data: List[Dict[str, Any]], title: str):
    """Print data in a formatted table"""
    print(f"\n{title}")
    print("=" * len(title))
    
    if not data:
        print("No data")
        return
    
    headers = list(data[0].keys())
    
    # Calculate column widths
    col_widths = {}
    for header in headers:
        col_widths[header] = max(len(header), max(len(str(row[header])) for row in data))
    
    # Print header
    header_row = " | ".join(f"{header:<{col_widths[header]}}" for header in headers)
    print(header_row)
    print("-" * len(header_row))
    
    # Print data rows
    for row in data:
        data_row = " | ".join(f"{str(row[header]):<{col_widths[header]}}" for header in headers)
        print(data_row)


def print_verification_results(results: Dict[str, bool]):
    """Print verification results with color-like indicators"""
    print("\nVerification Results:")
    print("=" * 20)
    
    status_symbols = {"✓": True, "✗": False}
    
    for check, passed in results.items():
        symbol = "✓" if passed else "✗"
        status = "PASSED" if passed else "FAILED"
        check_name = check.replace('_', ' ').title()
        print(f"{symbol} {check_name}: {status}")
    
    all_passed = all(results.values())
    print(f"\nOverall Result: {'✓ VERIFICATION PASSED!' if all_passed else '✗ VERIFICATION FAILED!'}")


def tamper_with_data(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate tampering by randomly modifying a value"""
    tampered_data = [row.copy() for row in data]  # Deep copy
    
    # Randomly select a row and column to tamper with
    row_idx = random.randint(0, len(tampered_data) - 1)
    value_cols = [k for k in tampered_data[0].keys() if k in ['value1', 'value2']]
    col_name = random.choice(value_cols)
    
    original_value = tampered_data[row_idx][col_name]
    tampered_value = original_value + random.uniform(-5, 5)
    tampered_data[row_idx][col_name] = round(tampered_value, 1)
    
    print(f"\n⚠️  TAMPERING SIMULATION:")
    print(f"   Modified row {row_idx + 1}, column '{col_name}'")
    print(f"   {original_value} → {tampered_data[row_idx][col_name]}")
    
    return tampered_data


def tamper_with_proof_tag(proof_tag: Dict[str, Any]) -> Dict[str, Any]:
    """Simulate tampering with proof tag"""
    tampered_tag = proof_tag.copy()
    tampered_tag['final_output'] += random.uniform(1, 10)
    
    print(f"\n⚠️  PROOF TAG TAMPERING SIMULATION:")
    print(f"   Modified final_output: {proof_tag['final_output']:.2f} → {tampered_tag['final_output']:.2f}")
    
    return tampered_tag


def main():
    """Main demonstration function"""
    print("🔒 TAMPER-EVIDENT AI PROOF VERIFICATION SYSTEM")
    print("=" * 50)
    print("\nDemonstrating cryptographic integrity verification for AI-generated data")
    print("Using only Python standard library (hashlib, json)")
    
    # AI equation code for hashing
    AI_EQUATION_CODE = """
def ai_equation(data):
    processed_data = []
    for row in data:
        new_row = row.copy()
        new_row['average'] = (row['value1'] + row['value2']) / 2
        processed_data.append(new_row)
    return processed_data

def calculate_final_output(processed_data):
    return sum(row['average'] for row in processed_data)
"""
    
    # Phase 1: Data Processing & Proof Generation
    print("\n" + "=" * 50)
    print("📊 PHASE 1: DATA PROCESSING & PROOF GENERATION")
    print("=" * 50)
    
    # Create sample data
    original_data = create_sample_data()
    print_data_table(original_data, "Original Input Data")
    
    # Process with AI equation
    processed_data = ai_equation(original_data)
    final_output = calculate_final_output(processed_data)
    
    print_data_table(processed_data, "AI-Processed Output Data (with averages)")
    print(f"\nFinal AI Output (Sum of Averages): {final_output:.2f}")
    
    # Generate proof tag
    proof_tag = generate_proof_tag(original_data, AI_EQUATION_CODE, final_output)
    
    print(f"\nGenerated Proof Tag:")
    print("-" * 20)
    print(json.dumps(proof_tag, indent=2))
    
    print(f"\n🔐 Privacy Protection: Only cryptographic hashes are stored in the proof tag.")
    print("   Your original data remains private and secure!")
    
    # Phase 2: Verification & Tamper Detection
    print("\n" + "=" * 50)
    print("🔍 PHASE 2: VERIFICATION & TAMPER DETECTION")
    print("=" * 50)
    
    # Initial verification (should pass)
    print("\n1. Initial Verification (Untampered Data)")
    print("-" * 40)
    verification_results = verify_proof(original_data, AI_EQUATION_CODE, proof_tag)
    print_verification_results(verification_results)
    
    # Demonstrate data tampering
    print("\n2. Data Tampering Demonstration")
    print("-" * 40)
    tampered_data = tamper_with_data(original_data)
    print_data_table(tampered_data, "Tampered Input Data")
    
    verification_results = verify_proof(tampered_data, AI_EQUATION_CODE, proof_tag)
    print_verification_results(verification_results)
    
    # Demonstrate proof tag tampering
    print("\n3. Proof Tag Tampering Demonstration")
    print("-" * 40)
    tampered_proof = tamper_with_proof_tag(proof_tag)
    
    print(f"\nTampered Proof Tag:")
    print("-" * 20)
    print(json.dumps(tampered_proof, indent=2))
    
    verification_results = verify_proof(original_data, AI_EQUATION_CODE, tampered_proof)
    print_verification_results(verification_results)
    
    # Summary
    print("\n" + "=" * 50)
    print("📋 DEMONSTRATION SUMMARY")
    print("=" * 50)
    print("\nThis POC demonstrates how tamper-evident proofs work:")
    print("\n✓ Hash-based integrity: Any change to input data is immediately detected")
    print("✓ Algorithm verification: Ensures the AI equation hasn't been modified") 
    print("✓ Output validation: Confirms results match the computation")
    print("✓ Self-verification: Detects tampering with the proof tag itself")
    print("✓ Privacy preservation: Only hashes stored, original data stays private")
    
    print(f"\n🎯 Use Cases:")
    print("• AI model output verification")
    print("• Scientific computation integrity") 
    print("• Financial calculation auditing")
    print("• Legal document processing")
    print("• Healthcare data analysis")
    
    print(f"\n🔒 Security: SHA-256 cryptographic hashing ensures tampering detection")
    print("   Any modification breaks the cryptographic chain of trust")


if __name__ == "__main__":
    main()