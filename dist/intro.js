// Simplified Luhn Algorithm Explanation Controller
let currentStep = 0;
const totalSteps = 9;

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
        case 0:
            setTimeout(() => animateCardIntro(), 500);
            break;
        case 1:
            setTimeout(() => animateCheckDigitFocus(), 800);
            break;
        case 2:
            setTimeout(() => animateAlgorithmDemo(), 1000);
            break;
        case 3:
            setTimeout(() => animateDoubling(), 800);
            break;
        case 4:
            setTimeout(() => animateFixing(), 800);
            break;
        case 5:
            setTimeout(() => animateAddition(), 800);
            break;
        case 6:
            setTimeout(() => animateFinalTest(), 800);
            break;
        case 7:
            setTimeout(() => animateValidExample(), 800);
            break;
    }
}

function animateCardIntro() {
    // Animate the card segments appearing one by one
    const segments = [
        '.major-industry-group',
        '.issuer-group',
        '.account-group', 
        '.check-digit-group'
    ];
    
    const labels = [
        '.major-industry',
        '.issuer-id',
        '.account-number',
        '.check-digit'
    ];
    
    segments.forEach((selector, index) => {
        setTimeout(() => {
            const element = document.querySelector(`#step-0 ${selector}`);
            const label = document.querySelector(`#step-0 ${labels[index]}`);
            
            if (element) {
                element.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    element.style.transform = 'scale(1)';
                }, 400);
            }
            
            if (label) {
                label.style.transform = 'scale(1.05)';
                label.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2)';
                setTimeout(() => {
                    label.style.transform = 'scale(1)';
                    label.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                }, 600);
            }
        }, index * 800);
    });
}

function animateCheckDigitFocus() {
    const checkDigit = document.querySelector('#step-1 .check-digit-highlight');
    if (checkDigit) {
        // The pulse animation is already defined in CSS
        checkDigit.style.animation = 'pulse-glow 2s ease-in-out infinite';
    }
}

function animateAlgorithmDemo() {
    const digits = document.querySelectorAll('#step-2 .digit.individual');
    
    // First, highlight the positions that need doubling
    digits.forEach((digit, index) => {
        const position = parseInt(digit.getAttribute('data-position'));
        
        // Skip check digit (position 1) and double every second digit from right
        if (position % 2 === 0 && position !== 1) {
            setTimeout(() => {
                digit.classList.add('highlight-double');
            }, index * 100);
        }
    });
}

function animateFixing() {
    const fixItems = document.querySelectorAll('#step-4 .fix-item');
    fixItems.forEach((item, index) => {
        setTimeout(() => {
            item.style.opacity = '1';
            item.style.transform = 'translateY(0) scale(1.05)';
            setTimeout(() => {
                item.style.transform = 'translateY(0) scale(1)';
            }, 200);
        }, index * 400);
    });
    
    setTimeout(() => {
        const resultRow = document.querySelector('#step-4 .result-row');
        resultRow.style.opacity = '1';
        resultRow.style.transform = 'translateY(0)';
        resultRow.style.backgroundColor = '#c8e6c9';
    }, fixItems.length * 400 + 500);
}

function animateAddition() {
    const unchangedDiv = document.querySelector('#step-5 .unchanged');
    const changedDiv = document.querySelector('#step-5 .changed');
    const totalDiv = document.querySelector('#step-5 .total');
    
    setTimeout(() => {
        unchangedDiv.style.opacity = '1';
        unchangedDiv.style.transform = 'translateY(0)';
    }, 300);
    
    setTimeout(() => {
        changedDiv.style.opacity = '1';
        changedDiv.style.transform = 'translateY(0)';
    }, 800);
    
    setTimeout(() => {
        totalDiv.style.opacity = '1';
        totalDiv.style.transform = 'translateY(0)';
        const bigResult = totalDiv.querySelector('.big-result');
        bigResult.style.fontSize = '2em';
        bigResult.style.color = '#d32f2f';
    }, 1300);
}

function animateFinalTest() {
    const testBox = document.querySelector('#step-6 .test-box');
    const question = testBox.querySelector('.question');
    const check = testBox.querySelector('.check');
    const result = testBox.querySelector('.result');
    
    setTimeout(() => {
        question.style.opacity = '1';
        question.style.transform = 'translateY(0)';
    }, 300);
    
    setTimeout(() => {
        check.style.opacity = '1';
        check.style.transform = 'translateY(0)';
    }, 800);
    
    setTimeout(() => {
        result.style.opacity = '1';
        result.style.transform = 'translateY(0) scale(1.1)';
        result.style.backgroundColor = '#ffcdd2';
    }, 1300);
}

function animateValidExample() {
    const correctCard = document.querySelector('#step-7 .correct-card');
    const quickCheck = document.querySelector('#step-7 .quick-check');
    
    setTimeout(() => {
        correctCard.style.opacity = '1';
        correctCard.style.transform = 'translateY(0) scale(1.05)';
        correctCard.style.backgroundColor = '#e8f5e8';
    }, 300);
    
    setTimeout(() => {
        quickCheck.style.opacity = '1';
        quickCheck.style.transform = 'translateY(0)';
        
        const validResult = quickCheck.querySelector('.result.valid');
        if (validResult) {
            validResult.style.backgroundColor = '#c8e6c9';
        }
    }, 800);
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