# Android Google Login - Debugging Guide

## Common Issues & Solutions

### Issue 1: "Please check your internet connection"
**Cause**: Network timeout or Google API unreachable

**Solutions**:
1. Check device internet connection
2. Ensure backend server is running
3. Check if Google APIs are accessible from your network
4. Try again after 30 seconds (cache refresh)

### Issue 2: "Token expired. Please sign in again."
**Cause**: Google token is expired or invalid

**Solutions**:
1. Sign out completely
2. Clear app cache: Settings → Apps → YourApp → Storage → Clear Cache
3. Sign in again
4. Ensure device time is correct

### Issue 3: "Invalid token format"
**Cause**: Token not properly formatted or corrupted

**Solutions**:
1. Reinstall the app
2. Update Google Play Services
3. Check if GoogleSignIn is properly initialized

### Issue 4: "Email already registered"
**Cause**: Email exists in database

**Solutions**:
1. Use a different email
2. Contact support to reset account
3. Try signing in instead of signing up

---

## Backend Logs to Check

When user reports issue, check backend logs:

```bash
# View recent logs
tail -100 logs/google-auth.log

# Search for specific email
grep "vijay.wiz@gmail.com" logs/google-auth.log

# Check for errors
grep "ERROR" logs/google-auth.log
```

---

## Android App Implementation Checklist

### Firebase Setup
- [ ] Firebase project created
- [ ] Google Sign-In enabled
- [ ] SHA-1 fingerprint added
- [ ] google-services.json downloaded

### Code Implementation
```dart
// Correct way to get ID token
final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
final GoogleSignInAuthentication? googleAuth = await googleUser?.authentication;
final String? idToken = googleAuth?.idToken;

// Send to backend
final response = await http.post(
  Uri.parse('http://your-backend.com/api/auth/google/verify'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'googleToken': idToken,
    'role': 'user' // or 'client'
  }),
);
```

### Error Handling
```dart
try {
  final response = await googleSignIn.signIn();
  // Handle success
} on SocketException {
  // Network error
  showError('Please check your internet connection');
} on TimeoutException {
  // Timeout
  showError('Request timed out. Please try again.');
} catch (error) {
  // Other errors
  showError('Login failed: ${error.toString()}');
}
```

---

## Network Debugging

### Check Backend Connectivity
```bash
# From Android device
adb shell
ping your-backend-domain.com

# Or use curl
curl -v http://your-backend.com/api/auth/google/test
```

### Check Google API Accessibility
```bash
# Test Firebase keys endpoint
curl https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com

# Test Google OAuth keys endpoint
curl https://www.googleapis.com/oauth2/v1/certs
```

---

## Production Checklist

- [ ] Backend running on production server
- [ ] CORS properly configured
- [ ] SSL/HTTPS enabled
- [ ] Google APIs accessible from production network
- [ ] Database connection stable
- [ ] Error logging enabled
- [ ] Monitoring alerts set up

---

## Quick Fixes

### Clear Cache & Retry
```bash
# Android
adb shell pm clear com.your.app.package
```

### Reset Backend
```bash
# Restart server
pm2 restart backend

# Or manually
node index.js
```

### Check Server Status
```bash
curl http://your-backend.com/api/health
```

---

## Support Information

If issue persists:
1. Check logs: `tail -100 logs/google-auth.log`
2. Verify network connectivity
3. Ensure Google APIs are accessible
4. Check device time synchronization
5. Try on different device/network
6. Contact support with error message

---

## Error Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad Request | Check token format |
| 401 | Unauthorized | Token expired, sign in again |
| 409 | Conflict | Email already registered |
| 503 | Service Unavailable | Network/API issue, retry later |
| 500 | Server Error | Backend issue, contact support |

