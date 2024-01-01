import React from 'react'
import { clsx } from './utilities/util'
import style from './vscodeUi.module.css'

export const VsTextFieldGroup = React.forwardRef<
  HTMLInputElement,
  { buttons: number; outerClassName?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>
>(({ buttons, children, outerClassName, ...props }, ref) => (
  <div className={clsx(outerClassName, style.vsTextFieldGroupInner)}>
    <VsTextField {...props} ref={ref} style={{ paddingRight: buttons * (iconButtonMargin + iconButtonSize) }} />
    <div className={style.vsTextFieldGroupButtons}>{children}</div>
  </div>
))

export const VsTextField = React.forwardRef<HTMLInputElement, { error?: string } & React.InputHTMLAttributes<HTMLInputElement>>(
  ({ error, className, ...props }, ref) => (
    <div className={style.textFieldWrapper}>
      <input {...props} ref={ref} className={clsx(className, style.vsTextFieldInner, !!error && style.vsTextFieldError)} />
      {error && <div className={style.vsTextFieldErrorMessage}>{error}</div>}
    </div>
  ),
)

const VsIconButtonInner = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => (
  <button {...props} className={clsx(props.className, style.vsIconButtonInner)} ref={ref}>
    {props.children}
  </button>
))

export const VsIconButton = React.forwardRef<HTMLButtonElement, { title: string } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  (props, ref) => <VsIconButtonInner ref={ref} role='button' {...props} aria-label={props.title} />,
)

export const VsIconCheckbox: React.FC<{
  checked: boolean
  title: string
  onToggle: (checked: boolean) => void
  children?: React.ReactNode
}> = ({ checked, title, onToggle, children }) => (
  <VsIconButton role='checkbox' title={title} aria-checked={checked} onClick={() => onToggle(!checked)}>
    {children}
  </VsIconButton>
)

export const iconButtonSize = 22
const iconButtonMargin = 3
