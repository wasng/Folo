# Subscribe from a website URL

The Web Discover input accepts arbitrary HTTP(S) URLs, domains without a scheme,
Markdown links, existing feed URLs and RSSHub routes. It does not restrict website
discovery to a domain allowlist. Keywords retain the original search behavior.

## Preview flow

1. Known, unambiguous source/target rules generate RSSHub candidates immediately.
   Bilibili profiles expose both dynamic updates and uploaded videos; upload pages
   prioritize videos. Xiaohongshu profiles map to notes. WeChat column and album
   URLs map to their respective feeds.
2. Other websites use the existing Folo feed lookup and discovery APIs. Native
   RSS/Atom and server-discovered candidates are deduplicated and can be selected
   in the preview. The input website is not fetched directly from the browser, so
   this adds no dependency on arbitrary websites allowing browser CORS.
3. If no candidate is found, preview tries RSSHub's generic HTML transformation
   route. It starts with `article` items and heading/link selectors. Choose
   **Extract page / adjust rules** to change selectors and preview again.
4. All candidates use the existing `FeedForm` and subscription operation. No
   subscription is created until the user confirms. Extraction can also be chosen
   when a mapped or discovered candidate cannot be fetched.

## Limits

Accepting any website URL does not guarantee that every page can be turned into
an updating feed. The configured RSSHub service must enable the HTML transform
route. In upstream RSSHub it is guarded by `ALLOW_USER_SUPPLY_UNSAFE_DOMAIN`; this
change does not enable that setting or alter server-side fetch protections.
If the service disables it, the preview displays its actual error. Use an RSSHub
instance that supports the needed route through Folo's existing instance settings.

Generic extraction reads server-rendered, public HTML. Login walls, CAPTCHAs,
JavaScript-only lists, source anti-bot checks and instance configuration can prevent
fetching. Selectors are a starting point, not inferred from every site's DOM.
Review the preview and adjust them for the target page. The existing HTML
transformation tool remains available for more advanced extraction options.

Short links and individual videos/notes may not contain the author's identifier.
The UI suggests using the final profile/list URL if server discovery cannot resolve
them. A WeChat article URL is not enough to infer a feed for all future account
posts; use a column/album URL or a separately generated account RSS feed.

Recurring fetching is performed by the existing Folo/RSSHub backend after
subscription. The local development server is still only the Web frontend.
For official account login use the existing debug entry while the local server
is running:

<https://app.folo.is/__debug_proxy.html?debug-host=http%3A%2F%2F127.0.0.1%3A2233>

## Rule sources

The deterministic mappings and generic route follow these RSSHub declarations:

- [Bilibili dynamic](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/bilibili/dynamic.ts)
- [Bilibili video](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/bilibili/video.ts)
- [Xiaohongshu profile](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/xiaohongshu/user.ts)
- [WeChat column](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/wechat/mp.ts)
- [WeChat album](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/wechat/msgalbum.ts)
- [HTML transformation](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/rsshub/transform/html.ts)

Tests cover route matching, arbitrary-domain discovery, native feeds, partial
service failures, extraction parameter encoding, candidate switching, and handing
the resolved URL to the existing subscription form. Live fetching and authenticated
subscription depend on the user's backend and source-site availability.
