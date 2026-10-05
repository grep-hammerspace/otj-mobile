import { forwardRef, useImperativeHandle, type ReactNode } from "react";

/**
 * Wraps a username + password pair so a password manager treats it as a login form.
 *
 * <p>Native has nothing to wrap — autofill there keys off each field's `autoComplete` /
 * `textContentType` — so this renders its children as they are and `submit()` just calls
 * `onSubmit`. `credential-form.web.tsx` is the half that does the work.
 */

export type CredentialFormHandle = {
  /** What the form's button and the last field's return key call, instead of `onSubmit` directly. */
  submit: () => void;
};

type Props = {
  onSubmit: () => void;
  children: ReactNode;
};

export const CredentialForm = forwardRef<CredentialFormHandle, Props>(function CredentialForm(
  { onSubmit, children },
  ref,
) {
  useImperativeHandle(ref, () => ({ submit: onSubmit }), [onSubmit]);
  return <>{children}</>;
});
