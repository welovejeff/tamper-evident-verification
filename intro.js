// Luhn Algorithm Animation Controller
let currentStep = 0;
const totalSteps = 9;

// Credit card numbers for demonstration
const cardNumber = "4024607236950748";

// DOM elements
const steps = document.querySelectorAll('.step');
const nextBtn = document.getElementById('next-btn');
const prevBtn = document.getElementById('prev-btn');
const demoBtn = document.getElementById('demo-btn');
const skipBtn = document.getElementById('skip-btn');
const progress = document.getElementById('progress');
const stepDots = document.querySelectorAll('.step-dot');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    updateDisplay();
    setupEventListeners();
    setupHoverEffects();
});

function setupEventListeners() {
    nextBtn.addEventListener('click', nextStep);
    prevBtn.addEventListener('click', prevStep);
    demoBtn.addEventListener('click', goToDemo);
    skipBtn.addEventListener('click', goToDemo);
    
    // Step dot navigation
    stepDots.forEach((dot, index) => {
        dot.addEventListener('click', () => goToStep(index));
    });
}

function setupHoverEffects() {
    // Set up hover effects for credit card labels
    const labelMappings = {
        'industry-text': 'industry',
        'issuer-text': 'issuer', 
        'account-text': 'account',
        'check-text': 'check'
    };
    
    Object.entries(labelMappings).forEach(([labelClass, numberClass]) => {
        const labels = document.querySelectorAll(`.${labelClass}`);
        const numberSections = document.querySelectorAll(`.${numberClass}`);
        
        labels.forEach(label => {
            label.addEventListener('mouseenter', () => {
                numberSections.forEach(section => {
                    section.classList.add('highlight-hover');
                });
            });
            
            label.addEventListener('mouseleave', () => {
                numberSections.forEach(section => {
                    section.classList.remove('highlight-hover');
                });
            });
        });
    });
}

function nextStep() {
    if (currentStep < totalSteps - 1) {
        currentStep++;
        updateDisplay();
    }
}

function prevStep() {
    if (currentStep > 0) {
        currentStep--;
        updateDisplay();
    }
}

function goToStep(stepNumber) {
    if (stepNumber >= 0 && stepNumber < totalSteps) {
        currentStep = stepNumber;
        updateDisplay();
    }
}

function updateDisplay() {
    // Hide all steps
    steps.forEach(step => step.style.display = 'none');
    
    // Show current step
    steps[currentStep].style.display = 'block';
    
    // Update progress bar
    const progressPercent = (currentStep / (totalSteps - 1)) * 100;
    progress.style.width = progressPercent + '%';
    
    // Update step dots
    stepDots.forEach((dot, index) => {
        dot.classList.remove('active', 'completed');
        if (index === currentStep) {
            dot.classList.add('active');
        } else if (index < currentStep) {
            dot.classList.add('completed');
        }
    });
    
    // Update button visibility
    prevBtn.style.display = currentStep > 0 ? 'block' : 'none';
    nextBtn.style.display = currentStep < totalSteps - 1 ? 'block' : 'none';
    demoBtn.style.display = currentStep === totalSteps - 1 ? 'block' : 'none';
    
    // Trigger step-specific animations
    triggerStepAnimations();
}

function triggerStepAnimations() {
    switch(currentStep) {
        case 3:
            setTimeout(() => highlightAlternateDigits(), 500);
            break;
        case 4:
            setTimeout(() => showDoubledValues(), 500);
            break;
        case 5:
            setTimeout(() => showCorrectedValues(), 500);
            break;
        case 6:
            setTimeout(() => animateSum(), 500);
            break;
    }
}

function highlightAlternateDigits() {
    const digits = document.querySelectorAll('#step-3 .digit-container');
    digits.forEach((digit, index) => {
        const position = parseInt(digit.getAttribute('data-position'));
        if (position % 2 === 0 && position !== 1) { // Even positions from right, excluding check digit
            setTimeout(() => {
                digit.classList.add('highlight');
            }, index * 100);
        }
    });
}

function showDoubledValues() {
    const containers = document.querySelectorAll('#step-4 .digit-container');
    const values = [4, 0, 2, 4, 6, 0, 7, 2, 3, 6, 9, 5, 0, 7, 4, 8];
    
    containers.forEach((container, index) => {
        const position = parseInt(container.getAttribute('data-position'));
        const arrayIndex = 16 - position;
        
        if (position % 2 === 0 && position !== 1) { // Even positions need doubling, excluding check digit
            const doubled = values[arrayIndex] * 2;
            const calculation = container.querySelector('.calculation');
            const result = container.querySelector('.result');
            
            setTimeout(() => {
                calculation.textContent = `${values[arrayIndex]}×2=${doubled}`;
                result.textContent = doubled;
                container.classList.add('doubled');
            }, index * 150);
        } else {
            // For non-doubled digits, just show the result
            const result = container.querySelector('.result');
            setTimeout(() => {
                result.textContent = values[arrayIndex];
                result.style.opacity = '1';
                result.style.transform = 'translateY(0)';
            }, index * 150);
        }
    });
}

function showCorrectedValues() {
    const containers = document.querySelectorAll('#step-5 .digit-container');
    const corrections = {
        7: { original: 6, doubled: 12, corrected: 3 },   // 6×2=12→3
        5: { original: 5, doubled: 10, corrected: 1 },   // 5×2=10→1
        3: { original: 7, doubled: 14, corrected: 5 }    // 7×2=14→5
    };
    
    Object.entries(corrections).forEach(([position, values]) => {
        const container = document.querySelector(`#step-5 .digit-container[data-position="${position}"]`);
        const calculation = container.querySelector('.calculation');
        const result = container.querySelector('.result');
        
        setTimeout(() => {
            calculation.textContent = `${values.original}×2=${values.doubled}→${values.corrected}`;
            result.textContent = values.corrected;
            container.classList.remove('doubled');
            container.classList.add('corrected');
        }, 800);
    });
}

function animateSum() {
    const containers = document.querySelectorAll('#step-6 .digit-container');
    let runningSum = 0;
    
    containers.forEach((container, index) => {
        setTimeout(() => {
            container.classList.add('summing');
            const result = container.querySelector('.result');
            const value = parseInt(result.textContent);
            runningSum += value;
            
            // Update the total after all digits are processed
            if (index === containers.length - 1) {
                setTimeout(() => {
                    document.getElementById('total-sum').textContent = runningSum;
                }, 200);
            }
        }, index * 100);
    });
}

function goToDemo() {
    // Add a smooth transition effect before navigating
    document.body.style.opacity = '0.7';
    setTimeout(() => {
        window.location.href = '/index.html';
    }, 300);
}

// Luhn algorithm implementation (for reference/validation)
function validateLuhn(cardNumber) {
    const digits = cardNumber.split('').map(Number).reverse();
    let sum = 0;
    
    for (let i = 0; i < digits.length; i++) {
        let digit = digits[i];
        
        if (i % 2 === 1) { // Every second digit from right (0-indexed)
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        
        sum += digit;
    }
    
    return sum % 10 === 0;
}

// Keyboard navigation
document.addEventListener('keydown', function(event) {
    switch(event.key) {
        case 'ArrowRight':
        case ' ':
            if (currentStep < totalSteps - 1) {
                nextStep();
            }
            event.preventDefault();
            break;
        case 'ArrowLeft':
            if (currentStep > 0) {
                prevStep();
            }
            event.preventDefault();
            break;
        case 'Enter':
            if (currentStep === totalSteps - 1) {
                goToDemo();
            } else {
                nextStep();
            }
            event.preventDefault();
            break;
        case 'Escape':
            goToDemo();
            event.preventDefault();
            break;
    }
});