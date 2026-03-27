# Mobile User API Documentation

**BASE URL:** `https://viralstatus-backend.serveminecraft.net/api/mobile/user`  
**Content-Type:** `application/json`

---

## REGISTRATION FLOW

```
Step 1 → Email + Password do → OTP email pe aata hai
Step 1 Verify → Email OTP verify karo
Step 2 → Mobile number do → OTP SMS/WhatsApp pe aata hai
Step 2 Verify → Mobile OTP verify karo
Step 3 → Profile complete karo → JWT Token milta hai ✅
```

---

## 1. Send Email OTP (Step 1 - Registration)

**POST** `/register/step1`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Test@1234",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent to your email. Please verify to continue.",
  "data": {
    "email": "user@example.com",
    "registrationStep": 1,
    "clientId": "CLI-E40OW7",
    "clientName": "Brahmakosh"
  }
}
```

**Error - Already Registered (400):**
```json
{
  "success": false,
  "message": "Email already registered. Please login."
}
```

---

## 2. Verify Email OTP (Step 1 Verify - Registration)

**POST** `/register/step1/verify`

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "email": "user@example.com",
    "emailVerified": true,
    "mobileVerified": false,
    "profileCompleted": false,
    "clientId": "CLI-E40OW7"
  }
}
```

**Error - Wrong OTP (400):**
```json
{
  "success": false,
  "message": "Invalid OTP"
}
```

**Error - OTP Expired (400):**
```json
{
  "success": false,
  "message": "OTP expired. Please resend."
}
```

---

## 3. Send Mobile OTP (Step 2 - Registration)

**POST** `/register/step2`

**Request Body:**
```json
{
  "email": "user@example.com",
  "mobile": "+919876543210",
  "otpMethod": "gupshup",
  "clientId": "CLI-E40OW7"
}
```

> `otpMethod` options: `"gupshup"` (India SMS) | `"twilio"` (International) | `"whatsapp"`

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent to your mobile via GUPSHUP. Please verify to continue.",
  "data": {
    "email": "user@example.com",
    "mobile": "+919876543210",
    "otpMethod": "gupshup",
    "registrationStep": 2,
    "clientId": "CLI-E40OW7"
  }
}
```

**Error - Email Not Verified (400):**
```json
{
  "success": false,
  "message": "Please verify email first (Step 1)"
}
```

---

## 4. Verify Mobile OTP (Step 2 Verify - Registration)

**POST** `/register/step2/verify`

**Request Body:**
```json
{
  "email": "user@example.com",
  "mobile": "+919876543210",
  "otp": "654321",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "data": {
    "email": "user@example.com",
    "mobile": "+919876543210",
    "mobileVerified": true,
    "emailVerified": true,
    "profileCompleted": false,
    "clientId": "CLI-E40OW7"
  }
}
```

---

## 5. Complete Profile & Get JWT Token (Step 3 - Registration)

**POST** `/register/step3`

**Request Body:**
```json
{
  "email": "user@example.com",
  "clientId": "CLI-E40OW7",
  "name": "Ram Sharma",
  "dob": "1990-05-15",
  "timeOfBirth": "10:30",
  "placeOfBirth": "Mumbai",
  "latitude": 19.0760,
  "longitude": 72.8777,
  "gowthra": "Kashyap"
}
```

> `email` aur `clientId` required hain, baaki sab optional hain.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile completed successfully. Registration complete!",
  "data": {
    "user": {
      "_id": "69c62ae3c8a22e56cf208aea",
      "email": "user@example.com",
      "name": "Ram Sharma",
      "mobile": "+919876543210",
      "dob": "1990-05-15",
      "timeOfBirth": "10:30",
      "placeOfBirth": "Mumbai",
      "latitude": 19.076,
      "longitude": 72.8777,
      "gowthra": "Kashyap",
      "emailVerified": true,
      "mobileVerified": true,
      "profileCompleted": true,
      "registrationStep": 3,
      "clientId": "CLI-E40OW7"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "registrationStep": 3,
    "registrationComplete": true,
    "emailVerified": true,
    "mobileVerified": true,
    "profileCompleted": true,
    "clientId": "CLI-E40OW7",
    "clientName": "Brahmakosh"
  }
}
```

---

## 6. User Login (Email & Password)

**POST** `/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Test@1234",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "...userObject" },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "clientId": "CLI-E40OW7",
    "clientName": "Brahmakosh"
  }
}
```

**Error - Registration Incomplete (403):**
```json
{
  "success": false,
  "message": "Registration incomplete. Please complete all registration steps.",
  "data": {
    "registrationStep": 2,
    "emailVerified": true,
    "mobileVerified": false
  }
}
```

**Error - Wrong Password (401):**
```json
{
  "success": false,
  "message": "Invalid email or password"
}
```

---

## 7. Google Login / Register

**POST** `/register/google`

**Request Body:**
```json
{
  "credential": "<Google ID Token>",
  "clientId": "CLI-E40OW7"
}
```

**Response - New User (Step 2 baaki hai):**
```json
{
  "success": true,
  "registrationComplete": false,
  "message": "Email verified with Google. Please continue with mobile verification (Step 2).",
  "data": {
    "email": "user@gmail.com",
    "emailVerified": true,
    "registrationStep": 1,
    "nextStep": "mobile_verification",
    "clientId": "CLI-E40OW7"
  }
}
```

**Response - Existing Fully Registered User:**
```json
{
  "success": true,
  "registrationComplete": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": { "...userObject" },
    "clientId": "CLI-E40OW7",
    "clientName": "Brahmakosh"
  }
}
```

---

## 8. Check Email Registration Status

**POST** `/check-email`

**Request Body:**
```json
{
  "email": "user@example.com",
  "clientId": "CLI-E40OW7"
}
```

**Response - Registered User:**
```json
{
  "success": true,
  "message": "User found",
  "data": {
    "registered": true,
    "emailVerified": true,
    "clientId": "CLI-E40OW7"
  }
}
```

**Response - Not Registered:**
```json
{
  "success": false,
  "message": "not registered",
  "data": {
    "registered": false,
    "registrationStep": 1,
    "nextStep": "mobile_verification",
    "clientId": "CLI-E40OW7"
  }
}
```

---

## 9. Resend Email OTP

**POST** `/register/resend-email-otp`

**Request Body:**
```json
{
  "email": "user@example.com",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP resent to your email."
}
```

---

## 10. Resend Mobile OTP

**POST** `/register/resend-mobile-otp`

**Request Body:**
```json
{
  "email": "user@example.com",
  "otpMethod": "gupshup",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP resent to your mobile via GUPSHUP."
}
```

---

## 11. Firebase Register

**POST** `/register/firebase`

**Request Body:**
```json
{
  "idToken": "<Firebase ID Token>",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Firebase email verified. Please continue with mobile verification (Step 2).",
  "data": {
    "email": "user@example.com",
    "emailVerified": true,
    "registrationStep": 1,
    "nextStep": "mobile_verification",
    "clientId": "CLI-E40OW7"
  }
}
```

---

## 12. Firebase Login

**POST** `/login/firebase`

**Request Body:**
```json
{
  "idToken": "<Firebase ID Token>",
  "clientId": "CLI-E40OW7"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "...userObject" },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "clientId": "CLI-E40OW7",
    "clientName": "Brahmakosh"
  }
}
```

---

## 13. Get User Profile (JWT Required)

**GET** `/profile`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "69c62ae3c8a22e56cf208aea",
      "email": "user@example.com",
      "name": "Ram Sharma",
      "mobile": "+919876543210",
      "dob": "1990-05-15",
      "timeOfBirth": "10:30",
      "placeOfBirth": "Mumbai",
      "latitude": 19.076,
      "longitude": 72.8777,
      "gowthra": "Kashyap",
      "emailVerified": true,
      "mobileVerified": true,
      "profileCompleted": true,
      "registrationStep": 3,
      "clientId": "CLI-E40OW7"
    }
  }
}
```

**Error - No Token (401):**
```json
{
  "success": false,
  "message": "No token provided"
}
```

---

## 14. Update User Profile (JWT Required)

**PUT** `/profile`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Request Body:**
```json
{
  "name": "Ram Kumar Sharma",
  "dob": "1990-05-15",
  "timeOfBirth": "10:30",
  "placeOfBirth": "Delhi",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "gowthra": "Bharadwaj"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated",
  "data": {
    "user": { "...updatedUserObject" }
  }
}
```

---

## COMMON ERROR RESPONSES

| Status | Message |
|--------|---------|
| 400 | Missing required fields |
| 401 | Invalid email or password / No token |
| 403 | Registration incomplete |
| 404 | User not found |
| 500 | Server error |

---

## IMPORTANT NOTES

1. `clientId` = `"CLI-E40OW7"` — har API mein required hai (Brahmakosh app ka client ID)
2. JWT token sirf Step 3 complete hone ke baad milta hai
3. Profile APIs mein `Authorization: Bearer <token>` header required hai
4. OTP 10 minute mein expire ho jata hai
5. Mobile number format: `+91XXXXXXXXXX` (country code ke saath)
6. Google login mein Step 1 auto-complete ho jata hai, Step 2 aur 3 karne padte hain

---

## OTP GATEWAYS

| Method | Gateway | Use |
|--------|---------|-----|
| `gupshup` | Gupshup Enterprise | India SMS (Primary) |
| `twilio` | Twilio | International SMS |
| `whatsapp` | Facebook Business API | WhatsApp OTP |

---

*Last Updated: March 2026 | Project: Mobile User Auth | ClientId: CLI-E40OW7*
