import { App, Button, InputNumber } from "antd";
import { AlipayCircleOutlined, CreditCardOutlined, WechatOutlined } from "@ant-design/icons";
import { useState } from "react";

import { useBeefTVConnection } from "@/components/layout/beeftv-connection-provider";
import { AppModal } from "@/components/ui/product/app-modal";
import { beefTVConnectionLabel, isBeefTVAuthenticated } from "@/services/api/beeftv-connection";

const rechargeAmounts = [50, 100, 200, 500];
const paymentMethods = [
    { label: "WeChat Pay", icon: WechatOutlined },
    { label: "Alipay", icon: AlipayCircleOutlined },
    { label: "International bank card", icon: CreditCardOutlined },
] as const;
const formatAmount = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AccountBalancePane() {
    const { message } = App.useApp();
    const account = useBeefTVConnection();
    const { connection, busy } = account;
    const connected = isBeefTVAuthenticated(connection);
    const pending = connection?.state === "pending" || connection?.state === "connecting";
    const name = connection?.account?.display_name || connection?.account?.username || connection?.account?.email || "BeefTV account";
    const [selection, setSelection] = useState<number | "custom">(100);
    const [customAmount, setCustomAmount] = useState<number | null>(null);
    const [method, setMethod] = useState<string>("WeChat Pay");
    const [checkout, setCheckout] = useState<{ amount: number } | null>(null);
    const amount = selection === "custom" ? customAmount : selection;
    const validAmount = typeof amount === "number" && Number.isFinite(amount) && amount >= 0.01;

    return <>
        <div className="account-balance-identity">
            <div><h3>{connected ? name : "Login to BeefTV"}</h3>
                {connected && connection?.account?.email && name !== connection.account.email ? <p>{connection.account.email}</p> : null}
                {connection?.state !== "connected" ? <p role="status" aria-live="polite">{beefTVConnectionLabel(connection)}</p> : null}
            </div>
            {!connected ? <Button loading={busy} disabled={pending} onClick={() => void account.connect()}>{pending ? "Waiting for authorization" : "Login"}</Button> : null}
        </div>
        {pending ? <div className="account-login-actions">
            {connection?.verificationUri ? <Button onClick={() => { void navigator.clipboard.writeText(connection.verificationUri!).then(() => message.success("Authorization address has been copied")).catch(() => message.error("Copy failed, please try again")); }}>Copy authorization address</Button> : null}
            <Button loading={busy} onClick={() => void account.cancel()}>Cancel this login</Button>
        </div> : null}
        <div className="account-balance-overview">
            <div><span className="account-balance-label">available balance</span><div className="account-balance-value">{connected && connection?.balance === "zero" ? "¥ 0.00" : "—"}</div>
                {!connected ? <p>Check account balance after logging in</p> : connection?.balance === "zero" ? <p>Can be used after recharging</p> : null}
            </div>
            <Button disabled={!connected || busy} onClick={() => void account.openAccount()}>Balance and usage</Button>
        </div>
        <section className="account-recharge" aria-labelledby="account-recharge-title">
            <div className="account-recharge-heading"><h3 id="account-recharge-title">Account recharge</h3><span>Not open yet</span></div>
            <div className="account-recharge-options" role="group" aria-label="Recharge amount">
                {rechargeAmounts.map((value) => <button type="button" key={value} aria-pressed={selection === value} onClick={() => setSelection(value)}>¥ {value}</button>)}
                <button type="button" aria-pressed={selection === "custom"} onClick={() => setSelection("custom")}>Customize</button>
            </div>
            {selection === "custom" ? <label className="account-custom-amount"><span>Recharge amount</span><InputNumber aria-label="Customized recharge amount" prefix="¥" value={customAmount} min={0.01} precision={2} placeholder="Enter amount" controls={false} onChange={setCustomAmount} /></label> : null}
            <div className="account-payment-section"><h3>Payment method</h3><PaymentMethodPicker value={method} onChange={setMethod} /></div>
            <div className="account-recharge-total"><div><span>Payment amount</span><strong>¥ {validAmount ? formatAmount(amount!) : "—"}</strong></div>
                <Button type="primary" disabled={!connected || !validAmount} onClick={() => { if (validAmount) setCheckout({ amount: amount! }); }}>Recharge</Button>
            </div>
        </section>
        <AppModal open={Boolean(checkout)} title="Confirm recharge" width={440} className="account-checkout-modal" onCancel={() => setCheckout(null)} footer={<div className="account-checkout-actions"><Button onClick={() => setCheckout(null)}>Return to modification</Button><Button type="primary" disabled>Payment is not open yet</Button></div>}>
            {checkout ? <div className="account-checkout-content">
                <div className="account-checkout-amount"><span>Payment amount</span><strong>¥ {formatAmount(checkout.amount)}</strong></div>
                <dl><div><dt>Recharge account</dt><dd>{name}</dd></div></dl>
                <div className="account-checkout-method"><span>Payment method</span><PaymentMethodPicker value={method} onChange={setMethod} /></div>
                <p role="status">The recharge service is not available yet, and no deductions will be made at this time.</p>
            </div> : null}
        </AppModal>
    </>;
}

function PaymentMethodPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <div className="account-payment-methods" role="group" aria-label="Payment method">
        {paymentMethods.map(({ label, icon: Icon }) => <button type="button" key={label} aria-pressed={value === label} onClick={() => onChange(label)}><Icon aria-hidden="true" /><span>{label}</span></button>)}
    </div>;
}
