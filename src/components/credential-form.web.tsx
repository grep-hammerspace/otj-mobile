import { forwardRef, useImperativeHandle, useRef, type FormEvent, type ReactNode } from "react";

/**
 * Web: a real `<form>`, because that is what a browser's password manager watches.
 *
 * <p>Safari in particular decides to offer "Save password" from a form's submit event, and a
 * React Native `Pressable` is a `div` that never fires one. So `submit()` goes through
 * `requestSubmit()` — a genuine submission the browser can see — and the handler cancels the
 * navigation and calls `onSubmit`. Nothing is ever posted by the form itself.
 *
 * <p>`display: contents` takes the form out of layout, so the fields stay direct flex children of
 * whatever laid them out before and keep its `gap`.
 */

export type CredentialFormHandle = {
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
  const form = useRef<HTMLFormElement>(null);

  useImperativeHandle(ref, () => ({ submit: () => form.current?.requestSubmit() }), []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form ref={form} onSubmit={handleSubmit} style={{ display: "contents" }} noValidate>
      {children}
    </form>
  );
});
