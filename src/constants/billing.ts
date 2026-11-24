export type BillingPlanCode = 'trial_24h' | 'monthly_1m' | 'annual_1y';
export type MobileMoneyProvider = 'airtel' | 'mtn';
export type BillingPaymentProvider = 'trial' | MobileMoneyProvider;

export interface BillingPlanConfig {
  code: BillingPlanCode;
  name: string;
  shortLabel: string;
  durationLabel: string;
  durationHours: number;
  priceUgx: number;
  priceLabel: string;
  audience: string;
  summary: string;
  highlights: string[];
}

export const MOBILE_MONEY_ACCOUNTS: Record<
  MobileMoneyProvider,
  {
    provider: MobileMoneyProvider;
    name: string;
    shortName: string;
    phone: string;
    displayPhone: string;
    ussdHint: string;
    accentBg: string;
    accentText: string;
    accentBorder: string;
  }
> = {
  airtel: {
    provider: 'airtel',
    name: 'Airtel Money',
    shortName: 'Airtel',
    phone: '+256708475220',
    displayPhone: '+256 708 475 220',
    ussdHint: 'Dial *185*9# or *185*1# -> Send Money -> Enter +256708475220',
    accentBg: 'bg-red-50',
    accentText: 'text-red-700',
    accentBorder: 'border-red-200',
  },
  mtn: {
    provider: 'mtn',
    name: 'MTN Mobile Money (MoMo)',
    shortName: 'MTN MoMo',
    phone: '+256789384426',
    displayPhone: '+256 789 384 426',
    ussdHint: 'Dial *165*3# or *165*1# -> Send Money -> Enter +256789384426',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    accentBorder: 'border-amber-300',
  },
};

export const BILLING_PLANS: BillingPlanConfig[] = [
  {
    code: 'trial_24h',
    name: '24-Hour Free Trial',
    shortLabel: '24h Trial',
    durationLabel: '24 Hours',
    durationHours: 24,
    priceUgx: 0,
    priceLabel: 'UGX 0',
    audience: 'For first-time evaluation',
    summary: 'Full workspace access for 24 hours before choosing a paid subscription.',
    highlights: [
      '24 hours full business workspace access',
      'Unlimited sales, receipts & order tracking',
      'No mobile money payment required to test',
    ],
  },
  {
    code: 'monthly_1m',
    name: '1 Month Plan',
    shortLabel: '1 Month',
    durationLabel: '30 Days',
    durationHours: 30 * 24,
    priceUgx: 10000,
    priceLabel: 'UGX 10,000',
    audience: 'For active monthly operations',
    summary: 'Complete monthly license paid once via Airtel Money or MTN MoMo.',
    highlights: [
      '30 days uninterrupted workspace & cloud sync',
      'Instant receipt generation & client ledger',
      'Pay UGX 10,000 via Airtel or MTN Mobile Money',
    ],
  },
  {
    code: 'annual_1y',
    name: '1 Year Plan',
    shortLabel: '1 Year',
    durationLabel: '365 Days',
    durationHours: 365 * 24,
    priceUgx: 100000,
    priceLabel: 'UGX 100,000',
    audience: 'Best value — saves UGX 20,000/yr',
    summary: 'Full 12-month business license with two months free compared to monthly billing.',
    highlights: [
      '365 days continuous access & priority support',
      'Save UGX 20,000 compared to 12 monthly renewals',
      'Pay UGX 100,000 via Airtel or MTN Mobile Money',
    ],
  },
];

export function getBillingPlanByCode(code: string): BillingPlanConfig | undefined {
  return BILLING_PLANS.find((p) => p.code === code);
}
