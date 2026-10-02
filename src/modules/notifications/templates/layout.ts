/**
 * The shell every email shares.
 *
 * Tables and inline styles, not flexbox and a stylesheet: Outlook and Gmail strip
 * <style> blocks and do not implement modern layout. This looks like 2005 because
 * email clients are.
 */
export function layout(input: { heading: string; body: string; action?: { label: string; url: string } }): string {
  const button = input.action
    ? `<tr><td style="padding:24px 0 8px">
         <a href="${input.action.url}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600">${input.action.label}</a>
       </td></tr>
       <tr><td style="color:#737373;font-size:12px;padding-bottom:8px;word-break:break-all">
         Hoặc mở liên kết này: ${input.action.url}
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="vi"><body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
        <tr><td style="font-size:18px;font-weight:700;padding-bottom:20px">Pupgy</td></tr>
        <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${input.heading}</td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#404040">${input.body}</td></tr>
        ${button}
        <tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;color:#a3a3a3;font-size:12px">
          Email này được gửi tự động từ Pupgy. Vui lòng không trả lời.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Integer VND, formatted the way the rest of the product does it. */
export function vnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} ₫`;
}

/**
 * Anything interpolated into the HTML goes through this first. Product names, shop
 * names and buyer names are user input, and an email is a document someone else's
 * client renders — treat it exactly like a web page.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function itemsTable(items: { productName: string; optionValues: string[]; quantity: number; lineTotal: number }[]): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f5f5f5">
          ${escapeHtml(item.productName)}
          ${item.optionValues.length > 0 ? `<div style="color:#737373;font-size:12px">${escapeHtml(item.optionValues.join(' / '))}</div>` : ''}
          <div style="color:#737373;font-size:12px">Số lượng: ${item.quantity}</div>
        </td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #f5f5f5;white-space:nowrap">${vnd(item.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:12px 0">${rows}</table>`;
}
