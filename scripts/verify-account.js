// scripts/verify-account.js
require('dotenv').config();
const axios = require('axios');

(async () => {
  try {
    const res = await axios.get(
      'https://api.paystack.co/bank/resolve',
      {
        params: {
          account_number: '1234567890',  // ← your real account number
          bank_code: '058',               // Zenith Bank code
        },
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    console.log('✅ Account verified:', res.data);
  } catch (err) {
    console.error('❌ Verification failed:', err.response?.data || err.message);
  }
})();