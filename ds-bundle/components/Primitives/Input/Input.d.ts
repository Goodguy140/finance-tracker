export type InputProps = {
  name?: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
};

export type CurrencyInputProps = InputProps & {
  /** Currency prefix shown inside the input, e.g. "CAD $" */
  currencyPrefix?: string;
  step?: number;
};

export type SelectProps = {
  name?: string;
  label?: string;
  options: Array<{ id: string; name: string }>;
  value?: string;
  defaultValue?: string;
  required?: boolean;
};

export type TextAreaProps = InputProps & {
  rows?: number;
};
