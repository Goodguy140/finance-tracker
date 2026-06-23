export type ButtonVariant = "primary" | "secondary" | "icon" | "danger" | "link";

export type ButtonProps = {
  variant?: ButtonVariant;
  /** Minimum height 44px on mobile, normal on desktop */
  touchTarget?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
};
