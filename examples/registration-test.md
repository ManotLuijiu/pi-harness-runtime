# Registration Flow Test

Test: User Registration Flow
URL: https://your-app.com/register

Dummy Data:
- email: test_user_123@example.com
- name: Test User
- password: SecurePass123!

Steps:
1. Fill email with email
2. Fill name with name
3. Fill password with password
4. Fill confirm_password with password
5. Click Submit
6. Verify "Welcome" message appears
7. Verify URL contains /dashboard

---

# Multi-Step Checkout Test

Test: Multi-Step Checkout Flow
URL: https://your-app.com/cart

Dummy Data:
- product: Premium Plan
- card_number: 4242424242424242
- expiry: 12/28
- cvv: 123
- address: 123 Test Street

Steps:
1. Click Add to Cart for product
2. Click Checkout
3. Fill shipping address with address
4. Click Next
5. Fill card number with card_number
6. Fill expiry with expiry
7. Fill CVV with cvv
8. Click Pay Now
9. Verify "Order Confirmed" appears
10. Verify URL contains /confirmation

---

# Contact Form Test

Test: Contact Form Submission
URL: https://your-app.com/contact

Dummy Data:
- name: John Doe
- email: john@example.com
- message: This is a test message for the contact form.

Steps:
1. Fill name with name
2. Fill email with email
3. Fill message with message
4. Click Submit
5. Verify "Thank you" appears
6. Verify "We'll respond" is visible
