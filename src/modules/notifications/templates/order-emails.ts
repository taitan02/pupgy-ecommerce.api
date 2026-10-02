import type { OrderStatus } from '../../../generated/prisma/enums.js';
import type { MailMessage } from '../../../infra/mail/mail.service.js';
import { escapeHtml, itemsTable, layout, vnd } from './layout.js';

/** What the templates need from an order. Deliberately not the Prisma row: an email
 *  should not break because a column was renamed. */
export interface OrderEmailData {
  code: string;
  shopName: string;
  buyerEmail: string;
  buyerName: string;
  recipientName: string;
  address: string;
  phone: string;
  items: { productName: string; optionValues: string[]; quantity: number; lineTotal: number }[];
  itemsSubtotal: number;
  shippingFee: number;
  total: number;
  cancelledBy: 'BUYER' | 'SELLER' | null;
  cancelReason: string | null;
}

const totals = (order: OrderEmailData) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
    <tr><td style="color:#737373">Tiền hàng</td><td align="right">${vnd(order.itemsSubtotal)}</td></tr>
    <tr><td style="color:#737373">Phí vận chuyển</td><td align="right">${vnd(order.shippingFee)}</td></tr>
    <tr><td style="font-weight:600;padding-top:6px">Tổng cộng</td><td align="right" style="font-weight:600;padding-top:6px">${vnd(order.total)}</td></tr>
  </table>`;

const shippingTo = (order: OrderEmailData) => `
  <p style="margin:16px 0 0;color:#737373;font-size:13px">
    Giao đến: ${escapeHtml(order.recipientName)} · ${escapeHtml(order.phone)}<br>${escapeHtml(order.address)}
  </p>`;

/** To the buyer, the moment the order is placed. */
export function orderPlacedEmail(order: OrderEmailData, orderUrl: string): MailMessage {
  return {
    to: order.buyerEmail,
    subject: `Đã đặt đơn ${order.code} tại ${order.shopName}`,
    html: layout({
      heading: 'Đặt hàng thành công',
      body: `<p style="margin:0">Cảm ơn bạn đã mua hàng tại <strong>${escapeHtml(order.shopName)}</strong>.
             Shop sẽ xác nhận đơn trong thời gian sớm nhất. Bạn thanh toán khi nhận hàng.</p>
             ${itemsTable(order.items)}${totals(order)}${shippingTo(order)}`,
      action: { label: 'Theo dõi đơn hàng', url: orderUrl },
    }),
    text: `Đã đặt đơn ${order.code} tại ${order.shopName}. Tổng cộng ${vnd(order.total)}. Theo dõi đơn: ${orderUrl}`,
  };
}

/** To the shop, the moment an order arrives. Different urgency, different link. */
export function orderReceivedEmail(order: OrderEmailData, sellerEmail: string, orderUrl: string): MailMessage {
  return {
    to: sellerEmail,
    subject: `Đơn hàng mới ${order.code}`,
    html: layout({
      heading: 'Bạn có đơn hàng mới',
      body: `<p style="margin:0">${escapeHtml(order.buyerName)} vừa đặt một đơn tại
             <strong>${escapeHtml(order.shopName)}</strong>. Hàng đã được trừ khỏi tồn kho và đang chờ bạn xác nhận.</p>
             ${itemsTable(order.items)}${totals(order)}${shippingTo(order)}`,
      action: { label: 'Xác nhận đơn', url: orderUrl },
    }),
    text: `Đơn hàng mới ${order.code} tại ${order.shopName}, tổng ${vnd(order.total)}. Xác nhận: ${orderUrl}`,
  };
}

/** Wording per state. CANCELLED is built separately because it needs the reason. */
const STATUS_COPY: Partial<Record<OrderStatus, { subject: string; heading: string; body: string }>> = {
  CONFIRMED: {
    subject: 'đã được shop xác nhận',
    heading: 'Shop đã xác nhận đơn của bạn',
    body: 'Shop đang chuẩn bị hàng. Bạn sẽ nhận được thông báo tiếp theo khi đơn được giao cho đơn vị vận chuyển.',
  },
  SHIPPING: {
    subject: 'đang được giao',
    heading: 'Đơn hàng đang trên đường',
    body: 'Đơn của bạn đã được giao cho đơn vị vận chuyển. Vui lòng chuẩn bị tiền mặt để thanh toán khi nhận hàng.',
  },
  DELIVERED: {
    subject: 'đã giao thành công',
    heading: 'Đơn hàng đã được giao',
    body: 'Cảm ơn bạn đã mua sắm tại Pupgy. Nếu có vấn đề với đơn hàng, hãy liên hệ shop sớm nhất có thể.',
  },
};

export function orderStatusEmail(
  order: OrderEmailData,
  status: OrderStatus,
  orderUrl: string,
): MailMessage | null {
  if (status === 'CANCELLED') {
    const who = order.cancelledBy === 'SELLER' ? 'Shop đã huỷ đơn này' : 'Bạn đã huỷ đơn này';
    return {
      to: order.buyerEmail,
      subject: `Đơn ${order.code} đã huỷ`,
      html: layout({
        heading: 'Đơn hàng đã huỷ',
        body: `<p style="margin:0">${who}.${order.cancelReason ? ` Lý do: ${escapeHtml(order.cancelReason)}.` : ''}
               Bạn không cần thanh toán bất kỳ khoản nào.</p>${itemsTable(order.items)}`,
        action: { label: 'Xem chi tiết', url: orderUrl },
      }),
      text: `Đơn ${order.code} đã huỷ. ${who}.${order.cancelReason ? ` Lý do: ${order.cancelReason}.` : ''}`,
    };
  }

  const copy = STATUS_COPY[status];
  // PENDING has its own email (orderPlacedEmail); anything else is a state we do not
  // write to the buyer about, and returning null is how the worker skips it.
  if (!copy) return null;

  return {
    to: order.buyerEmail,
    subject: `Đơn ${order.code} ${copy.subject}`,
    html: layout({
      heading: copy.heading,
      body: `<p style="margin:0">${copy.body}</p>${itemsTable(order.items)}${totals(order)}`,
      action: { label: 'Xem đơn hàng', url: orderUrl },
    }),
    text: `Đơn ${order.code} ${copy.subject}. Xem đơn: ${orderUrl}`,
  };
}
