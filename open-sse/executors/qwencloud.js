import { DefaultExecutor } from "./default.js";
import { resolveQwenCloudUrl } from "../services/qwencloud.js";

// Same transports as the registry (OpenAI / Claude / Responses lanes); only the
// host follows the key type — see services/qwencloud.js.
export class QwenCloudExecutor extends DefaultExecutor {
  constructor() {
    super("qwencloud");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return resolveQwenCloudUrl(super.buildUrl(model, stream, urlIndex, credentials), credentials?.apiKey);
  }
}

export default QwenCloudExecutor;
