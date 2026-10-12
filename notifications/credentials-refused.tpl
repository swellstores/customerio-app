<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Customer.io is not receiving data</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;">Customer.io is not receiving data from {{ store.name }}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">{{ message }}</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">Until this is corrected, customers and their order, cart and subscription events do not reach your Customer.io workspace, and campaigns that depend on them do not start.</p>
                <p style="margin:0 0 8px;font-size:15px;line-height:24px;font-weight:600;">To fix it</p>
                <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:24px;">
                  <li>In Customer.io, open Settings → API credentials → Track API keys and copy the Site ID and API key.</li>
                  <li>In Swell, open Apps → Customer.io → Settings, paste both values and save.</li>
                  <li>Press Test connection.</li>
                </ol>
                <p style="margin:0 0 24px;">
                  <a href="{{ store.admin_url }}/admin/apps{% if app_id %}/{{ app_id }}?tab=settings{% endif %}" style="display:inline-block;padding:10px 20px;background-color:#1f2933;color:#ffffff;font-size:15px;line-height:20px;text-decoration:none;border-radius:6px;">Open the Customer.io app</a>
                </p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#616e7c;">Events from the last 48 hours are kept and delivered over the hours after the connection works again. Older events are not sent. If the subject of this email starts with (TEST), the problem is in your store's test environment: switch the dashboard to it after opening the app.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
