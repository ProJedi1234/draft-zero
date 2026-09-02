# Provider routing

Under the model picker sits a provider picker: which upstream host actually
serves the model. Most open-weights models are served by several, and they are
not interchangeable — the same weights can differ by an order of magnitude in
output speed and by half in price, and a third-party host often serves a shorter
context window than the lab does. So each row in the menu carries the numbers the
choice turns on: median tokens/sec over the last half hour, price in/out per 1M,
window, and quantization, with uptime shown only when it is bad enough to be a
reason against.

**Auto** is the default and the top row — OpenRouter's own ranking, which is the
right answer until you have a reason it isn't. A pinned provider is stored on the
story as `provider_tag` (NULL is Auto) and sent as `provider.only` with fallbacks
off: pinning a provider and silently being served by another would make the
picker a decoration. Tags are model-specific, so switching models resets the pin,
and a tag that has since left the model's endpoint list falls back to Auto rather
than failing the request. When a pinned endpoint has a shorter window than the
model, that shorter window becomes the context ceiling.

## Zero data retention

Zero data retention is a routing policy, not a checkbox on a request. It can be
switched on for the whole app, for a model profile, or for one story, and the
strictest setting in force wins. Under it, the model and provider pickers grey
out every endpoint that retains prompts, requests are pinned to the endpoints
that do not, and a request that could only be served by a retaining host fails
rather than falling through. Retention is tracked per model group, not per
account, because that is how OpenRouter reports it.
