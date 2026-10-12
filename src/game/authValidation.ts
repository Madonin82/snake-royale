export interface EmailAuthValidationInput {
  mode: 'SIGN_IN' | 'SIGN_UP';
  email: string;
  password: string;
  confirmPassword?: string;
}

export interface EmailAuthValidationResult {
  valid: boolean;
  trimmedEmail: string;
  error: string | null;
}

export function validateEmailAuthForm(input: EmailAuthValidationInput): EmailAuthValidationResult {
  const trimmedEmail = input.email.trim();
  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    return {
      valid: false,
      trimmedEmail,
      error: 'Please enter a valid email address.',
    };
  }
  if (!input.password) {
    return {
      valid: false,
      trimmedEmail,
      error: 'Please enter a password.',
    };
  }
  if (input.mode === 'SIGN_UP') {
    if (input.password.length < 6) {
      return {
        valid: false,
        trimmedEmail,
        error: 'Password must be at least 6 characters.',
      };
    }
    if (!input.confirmPassword) {
      return {
        valid: false,
        trimmedEmail,
        error: 'Please re-type your password to verify.',
      };
    }
    if (input.password !== input.confirmPassword) {
      return {
        valid: false,
        trimmedEmail,
        error: 'Passwords do not match. Please type the same password twice.',
      };
    }
  }
  return {
    valid: true,
    trimmedEmail,
    error: null,
  };
}
