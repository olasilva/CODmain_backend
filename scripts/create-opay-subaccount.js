// scripts/create-opay-subaccount.js
require('dotenv').config();
const axios = require('axios');

// ─── CONFIGURATION ───
// Replace this with the REAL OPay account number (10 digits)
const ACCOUNT_NUMBER = '8136319393';
const BUSINESS_NAME = 'COD Platform Fee Account - OPay';

const authHeader = 'Bearer ' + process.env.PAYSTACK_SECRET_KEY;

(async () => {
  try {
    // Step 1: Fetch the list of banks and find OPay
    console.log('Fetching bank list to find OPay...');
    const banksRes = await axios.get('https://api.paystack.co/bank?country=nigeria', {
      headers: { Authorization: authHeader },
    });

    const opayBank = banksRes.data.data.find((b) =>
      /opay/i.test(b.name)
    );

    if (!opayBank) {
      console.error('Could not find OPay in the bank list.');
      return;
    }

    console.log(`Found OPay: ${opayBank.name} (Code: ${opayBank.code})`);
    const BANK_CODE = opayBank.code;

    // Step 2: Verify the OPay account
    console.log('Verifying account...');
    const verifyRes = await axios.get('https://api.paystack.co/bank/resolve', {
      params: {
        account_number: ACCOUNT_NUMBER,
        bank_code: BANK_CODE,
      },
      headers: { Authorization: authHeader },
    });

    if (!verifyRes.data?.status) {
      console.error('Account verification failed:');
      console.error(verifyRes.data);
      return;
    }

    console.log('Account verified:', verifyRes.data.data.account_name);

    // Step 3: Create the subaccount
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
          Authorization: authHeader,
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