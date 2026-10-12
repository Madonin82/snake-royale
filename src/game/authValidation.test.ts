import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailAuthForm } from './authValidation';

test('validateEmailAuthForm validates sign-in email and password', () => {
  assert.deepEqual(
    validateEmailAuthForm({ mode: 'SIGN_IN', email: '', password: 'secret' }),
    { valid: false, trimmedEmail: '', error: 'Please enter a valid email address.' },
  );
  assert.deepEqual(
    validateEmailAuthForm({ mode: 'SIGN_IN', email: 'player@example.com', password: '' }),
    { valid: false, trimmedEmail: 'player@example.com', error: 'Please enter a password.' },
  );
  assert.deepEqual(
    validateEmailAuthForm({ mode: 'SIGN_IN', email: '  player@example.com  ', password: 'secret' }),
    { valid: true, trimmedEmail: 'player@example.com', error: null },
  );
});

test('validateEmailAuthForm requires typing password twice with exact match on sign-up', () => {
  assert.deepEqual(
    validateEmailAuthForm({
      mode: 'SIGN_UP',
      email: 'player@example.com',
      password: '12345',
      confirmPassword: '12345',
    }),
    { valid: false, trimmedEmail: 'player@example.com', error: 'Password must be at least 6 characters.' },
  );

  assert.deepEqual(
    validateEmailAuthForm({
      mode: 'SIGN_UP',
      email: 'player@example.com',
      password: 'password123',
      confirmPassword: '',
    }),
    { valid: false, trimmedEmail: 'player@example.com', error: 'Please re-type your password to verify.' },
  );

  assert.deepEqual(
    validateEmailAuthForm({
      mode: 'SIGN_UP',
      email: 'player@example.com',
      password: 'password123',
      confirmPassword: 'password999',
    }),
    {
      valid: false,
      trimmedEmail: 'player@example.com',
      error: 'Passwords do not match. Please type the same password twice.',
    },
  );

  assert.deepEqual(
    validateEmailAuthForm({
      mode: 'SIGN_UP',
      email: 'player@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }),
    { valid: true, trimmedEmail: 'player@example.com', error: null },
  );
});
