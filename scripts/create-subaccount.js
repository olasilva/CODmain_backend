// scripts/create-subaccount.js
require('dotenv').config();

const axios = require('axios');

// ─── CONFIGURATION ───
// Replace these three values with the REAL recipient details
const BUSINESS_NAME = 'COD Platform Fee Account';
const BANK_CODE = '058';
const ACCOUNT_NUMBER = '1234567890';

(async () => {
  try {
    // Step 1: Verify the account exists before creating the subaccount
    console.log('Verifying account...');
    const verifyRes = await axios.get(
      'https://api.paystack.co/bank/resolve',
      {
        params: {
          account_number: ACCOUNT_NUMBER,
          bank_code: BANK_CODE,
        },
        headers: {
          Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
        },
      }
    );

    if (!verifyRes.data || !verifyRes.data.status) {
      console.error('Account verification failed:');
      console.error(verifyRes.data);
      return;
    }

    console.log('Account verified:', verifyRes.data.data.account_name);

    // Step 2: Create the subaccount
    console.log('Creating subaccount...');
    const res = await axios.post(
      'https://api.paystack.co/subaccount',
      {
        business_name: BUSINESS_NAME,
        settlement_bank: BANK_CODE,
        account_number: ACCOUNT_NUMBER,
        percentage_charge: 0,
        description: 'Receives 50 Naira platform fee per transaction',
      },
      {
        headers: {
          Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Subaccount created:');
    console.log(JSON.stringify(res.data.data, null, 2));
    console.log('');
    console.log('Save this code in .env as PAYSTACK_SUBACCOUNT_CODE:');
    console.log('   PAYSTACK_SUBACCOUNT_CODE=' + res.data.data.subaccount_code);
  } catch (err) {
    console.error('Error:');
    console.error(err.response ? err.response.data : err.message);
  }
})();