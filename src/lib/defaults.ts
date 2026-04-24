import { AccountType, CategoryKind, User } from "@prisma/client";
import { getCountryConfig } from "@/lib/country-config";
import { prisma } from "@/lib/prisma";

export async function ensureDefaultDataForUser(user: User) {
  const config = getCountryConfig(user.countryCode);

  const [categoryCount, accountCount] = await Promise.all([
    prisma.category.count({ where: { userId: user.id } }),
    prisma.account.count({ where: { userId: user.id } }),
  ]);

  if (categoryCount === 0) {
    await prisma.category.createMany({
      data: [
        ...config.defaultExpenseCategories.map((name) => ({
          userId: user.id,
          name,
          kind: CategoryKind.EXPENSE,
          isDefault: true,
        })),
        ...config.defaultIncomeCategories.map((name) => ({
          userId: user.id,
          name,
          kind: CategoryKind.INCOME,
          isDefault: true,
        })),
      ],
    });
  }

  if (accountCount === 0) {
    await prisma.account.createMany({
      data: [
        {
          userId: user.id,
          name: "Main Chequing",
          type: AccountType.CHEQUING,
          currency: config.defaultCurrency,
          countryCode: config.code,
        },
        {
          userId: user.id,
          name: "Primary Credit Card",
          type: AccountType.CREDIT_CARD,
          currency: config.defaultCurrency,
          countryCode: config.code,
        },
      ],
    });
  }
}
