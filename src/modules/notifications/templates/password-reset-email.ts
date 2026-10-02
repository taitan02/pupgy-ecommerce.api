import type { MailMessage } from '../../../infra/mail/mail.service.js';
import { layout } from './layout.js';

export function passwordResetEmail(input: {
  to: string;
  resetUrl: string;
  ttlMinutes: number;
}): MailMessage {
  return {
    to: input.to,
    subject: 'Đặt lại mật khẩu Pupgy',
    html: layout({
      heading: 'Đặt lại mật khẩu',
      body: `<p style="margin:0">Bạn vừa yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới để chọn mật khẩu mới.
             Liên kết có hiệu lực trong <strong>${input.ttlMinutes} phút</strong> và chỉ dùng được một lần.</p>
             <p style="margin:12px 0 0">Nếu bạn không yêu cầu điều này, hãy bỏ qua email — mật khẩu hiện tại không thay đổi.</p>`,
      action: { label: 'Đặt lại mật khẩu', url: input.resetUrl },
    }),
    text: `Đặt lại mật khẩu Pupgy: ${input.resetUrl} (có hiệu lực ${input.ttlMinutes} phút, dùng một lần). Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
  };
}
