// Sample data and global variables
let originalData = [
    { id: 1, value1: 10.5, value2: 8.2 },
    { id: 2, value1: 25.3, value2: 19.6 },
    { id: 3, value1: 18.7, value2: 22.4 },
    { id: 4, value1: 33.2, value2: 28.7 },
    { id: 5, value1: 42.1, value2: 35.5 },
    { id: 6, value1: 15.8, value2: 12.3 },
    { id: 7, value1: 28.9, value2: 31.1 }
];

let currentData = JSON.parse(JSON.stringify(originalData)); // Deep copy
let processedData = [];
let finalOutput = 0;
let proofTag = {};

// AI equation code for hashing
const AI_EQUATION_CODE = `
function processDataWithAI(data) {
    return data.map(row => ({
        ...row,
        average: (row.value1 + row.value2) / 2
    }));
}

function calculateFinalOutput(processedData) {
    return processedData.reduce((sum, row) => sum + row.average, 0);
}
`;

// Utility functions
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function dataToCSVString(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvLines = [headers.join(',')];
    
    data.forEach(row => {
        const values = headers.map(header => row[header]);
        csvLines.push(values.join(','));
    });
    
    return csvLines.join('\n');
}

function createDataTable(data, containerId) {
    const container = document.getElementById(containerId);
    
    if (data.length === 0) {
        container.innerHTML = '<p>No data</p>';
        return;
    }
    
    const headers = Object.keys(data[0]);
    
    let tableHTML = '<table><thead><tr>';
    headers.forEach(header => {
        tableHTML += `<th>${header}</th>`;
    });
    tableHTML += '</tr></thead><tbody>';
    
    data.forEach(row => {
        tableHTML += '<tr>';
        headers.forEach(header => {
            const value = typeof row[header] === 'number' ? row[header].toFixed(1) : row[header];
            tableHTML += `<td>${value}</td>`;
        });
        tableHTML += '</tr>';
    });
    
    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;
}

// AI processing functions
function processDataWithAI(data) {
    return data.map(row => ({
        ...row,
        average: (row.value1 + row.value2) / 2
    }));
}

function calculateFinalOutput(processedData) {
    return processedData.reduce((sum, row) => sum + row.average, 0);
}

// Proof generation
async function generateProofTag(inputData, equationCode, finalOutput) {
    const inputDataStr = dataToCSVString(inputData);
    const inputDataHash = await sha256(inputDataStr);
    const equationHash = await sha256(equationCode);
    
    const proof = {
        input_data_hash: inputDataHash,
        equation_hash: equationHash,
        final_output: finalOutput
    };
    
    const proofStr = JSON.stringify(proof, null, 2);
    const proofTagHash = await sha256(proofStr);
    
    proof.proof_tag_hash = proofTagHash;
    
    return proof;
}

// Verification functions
async function verifyProof(inputData, equationCode, proofTag) {
    const results = {};
    
    // Verify input data hash
    const inputDataStr = dataToCSVString(inputData);
    const computedInputHash = await sha256(inputDataStr);
    results.input_data = computedInputHash === proofTag.input_data_hash;
    
    // Verify equation hash
    const computedEquationHash = await sha256(equationCode);
    results.equation = computedEquationHash === proofTag.equation_hash;
    
    // Verify final output by recomputing
    const reprocessedData = processDataWithAI(inputData);
    const computedFinalOutput = calculateFinalOutput(reprocessedData);
    results.final_output = Math.abs(computedFinalOutput - proofTag.final_output) < 1e-10;
    
    // Verify proof tag self-hash
    const proofWithoutSelfHash = {
        input_data_hash: proofTag.input_data_hash,
        equation_hash: proofTag.equation_hash,
        final_output: proofTag.final_output
    };
    const proofStr = JSON.stringify(proofWithoutSelfHash, null, 2);
    const computedProofHash = await sha256(proofStr);
    results.proof_tag = computedProofHash === proofTag.proof_tag_hash;
    
    return results;
}

// Tampering simulation
function tamperWithData() {
    const rowIndex = Math.floor(Math.random() * currentData.length);
    const valueKeys = ['value1', 'value2'];
    const keyToTamper = valueKeys[Math.floor(Math.random() * valueKeys.length)];
    
    const originalValue = currentData[rowIndex][keyToTamper];
    const tamperAmount = (Math.random() - 0.5) * 10; // Random change between -5 and +5
    const tamperedValue = Math.round((originalValue + tamperAmount) * 10) / 10;
    
    currentData[rowIndex][keyToTamper] = tamperedValue;
    
    // Log tampering
    const logElement = document.getElementById('tampering-log');
    logElement.innerHTML = `
        <h4>⚠️ Data Tampering Simulation</h4>
        <p>Modified row ${rowIndex + 1}, column '${keyToTamper}'</p>
        <p>${originalValue} → ${tamperedValue}</p>
        <p><em>Click "Verify Integrity" to see how this tampering is detected!</em></p>
    `;
    logElement.className = 'tampering-log show';
    
    // Update display
    createDataTable(currentData, 'current-data');
}

function tamperWithProofTag() {
    const editor = document.getElementById('proof-editor');
    let currentProof = JSON.parse(editor.value);
    
    // Tamper with final output
    const originalOutput = currentProof.final_output;
    const tamperAmount = Math.random() * 20 - 10; // Random change between -10 and +10
    currentProof.final_output = Math.round((originalOutput + tamperAmount) * 100) / 100;
    
    editor.value = JSON.stringify(currentProof, null, 2);
    
    // Log tampering
    const logElement = document.getElementById('tampering-log');
    logElement.innerHTML = `
        <h4>⚠️ Proof Tag Tampering Simulation</h4>
        <p>Modified final_output: ${originalOutput.toFixed(2)} → ${currentProof.final_output.toFixed(2)}</p>
        <p><em>Click "Verify Integrity" to see how this tampering is detected!</em></p>
    `;
    logElement.className = 'tampering-log show';
}

// Display functions
function displayVerificationResults(results) {
    const container = document.getElementById('verification-results');
    const allPassed = Object.values(results).every(r => r);
    
    container.className = `verification-results ${allPassed ? 'passed' : 'failed'}`;
    
    let html = `<h3>Verification Results</h3>`;
    
    const checkNames = {
        'input_data': 'Input Data Integrity',
        'equation': 'AI Algorithm Integrity',
        'final_output': 'Output Consistency',
        'proof_tag': 'Proof Tag Self-Verification'
    };
    
    Object.entries(results).forEach(([check, passed]) => {
        const symbol = passed ? '✓' : '✗';
        const status = passed ? 'PASSED' : 'FAILED';
        const checkName = checkNames[check];
        html += `<div class="verification-item ${passed ? 'passed' : 'failed'}">${symbol} ${checkName}: ${status}</div>`;
    });
    
    html += `<div style="margin-top: 15px; font-size: 1.2rem; font-weight: bold;">`;
    html += allPassed 
        ? '✓ OVERALL VERIFICATION PASSED! Data integrity confirmed.' 
        : '✗ OVERALL VERIFICATION FAILED! Tampering detected!';
    html += '</div>';
    
    container.innerHTML = html;
    container.style.display = 'block';
}

// Event handlers
document.addEventListener('DOMContentLoaded', function() {
    // Initialize display
    createDataTable(originalData, 'original-data');
    
    // Process data button
    document.getElementById('process-data').addEventListener('click', async function() {
        // Process data with AI
        processedData = processDataWithAI(originalData);
        finalOutput = calculateFinalOutput(processedData);
        
        // Display processed data
        createDataTable(processedData, 'processed-data');
        document.getElementById('final-output').textContent = finalOutput.toFixed(2);
        document.getElementById('processed-section').style.display = 'block';
        
        // Generate proof tag
        proofTag = await generateProofTag(originalData, AI_EQUATION_CODE, finalOutput);
        document.getElementById('proof-tag').textContent = JSON.stringify(proofTag, null, 2);
        document.getElementById('proof-section').style.display = 'block';
        
        // Show phase 2
        document.getElementById('phase2').style.display = 'block';
        
        // Initialize phase 2 displays
        createDataTable(currentData, 'current-data');
        document.getElementById('proof-editor').value = JSON.stringify(proofTag, null, 2);
    });
    
    // Verify button
    document.getElementById('verify-data').addEventListener('click', async function() {
        try {
            const proofToVerify = JSON.parse(document.getElementById('proof-editor').value);
            const results = await verifyProof(currentData, AI_EQUATION_CODE, proofToVerify);
            displayVerificationResults(results);
        } catch (error) {
            const container = document.getElementById('verification-results');
            container.className = 'verification-results failed';
            container.innerHTML = `<h3>Verification Error</h3><p>Invalid proof tag format: ${error.message}</p>`;
            container.style.display = 'block';
        }
    });
    
    // Tamper data button
    document.getElementById('tamper-data').addEventListener('click', function() {
        tamperWithData();
    });
    
    // Tamper proof button
    document.getElementById('tamper-proof').addEventListener('click', function() {
        tamperWithProofTag();
    });
    
    // Reset button
    document.getElementById('reset-data').addEventListener('click', function() {
        currentData = JSON.parse(JSON.stringify(originalData));
        createDataTable(currentData, 'current-data');
        document.getElementById('proof-editor').value = JSON.stringify(proofTag, null, 2);
        document.getElementById('tampering-log').className = 'tampering-log';
        document.getElementById('verification-results').style.display = 'none';
    });
});