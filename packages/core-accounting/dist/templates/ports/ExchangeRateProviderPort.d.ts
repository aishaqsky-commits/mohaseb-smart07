export interface ExchangeRateProviderPort {
    /** يعيد سعر الصرف كنص Decimal، من جدول exchange_rates المصمَّم سابقًا */
    getRate(tenantId: string, fromCurrency: string, toCurrency: string): Promise<string>;
}
