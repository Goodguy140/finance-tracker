import { AccountType } from "@prisma/client";

export type CountryConfig = {
  code: string;
  name: string;
  defaultCurrency: string;
  supportedCurrencies: string[];
  accountTypes: AccountType[];
  defaultExpenseCategories: string[];
  defaultIncomeCategories: string[];
};

export const countryConfigMap: Record<string, CountryConfig> = {
  CA: {
    code: "CA",
    name: "Canada",
    defaultCurrency: "CAD",
    supportedCurrencies: ["CAD", "USD"],
    accountTypes: [
      AccountType.CHEQUING,
      AccountType.SAVINGS,
      AccountType.CREDIT_CARD,
      AccountType.TFSA,
      AccountType.RRSP,
      AccountType.FHSA,
      AccountType.NON_REGISTERED,
      AccountType.CASH,
    ],
    defaultExpenseCategories: [
      "Groceries",
      "Fun",
      "Utilities",
      "Rent",
      "Recurring Services",
      "Transport",
      "Dining",
      "Health",
      "Insurance",
    ],
    defaultIncomeCategories: ["Salary", "Freelance", "Investment Income", "Other Income"],
  },
  JP: {
    code: "JP",
    name: "Japan",
    defaultCurrency: "JPY",
    supportedCurrencies: ["JPY", "USD"],
    accountTypes: [
      AccountType.CHEQUING,
      AccountType.SAVINGS,
      AccountType.CREDIT_CARD,
      AccountType.TFSA,
      AccountType.RRSP,
      AccountType.FHSA,
      AccountType.NON_REGISTERED,
      AccountType.CASH,
    ],
    defaultExpenseCategories: [
      "食費",
      "日用品",
      "家賃",
      "光熱費",
      "交通費",
      "外食",
      "医療",
      "保険",
      "サブスクリプション",
    ],
    defaultIncomeCategories: ["給与", "副業", "投資収入", "その他収入"],
  },
};

export function getCountryConfig(countryCode: string | null | undefined): CountryConfig {
  return countryConfigMap[countryCode ?? "CA"] ?? countryConfigMap.CA;
}

export function getDefaultTimezone(countryCode: string | null | undefined) {
  const normalized = (countryCode ?? "").toUpperCase();
  if (normalized === "JP") return "Asia/Tokyo";
  return "America/Toronto";
}
