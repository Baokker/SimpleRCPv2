// Route Node's global fetch through HTTPS_PROXY/NO_PROXY, as curl does on this machine.
import { EnvHttpProxyAgent, setGlobalDispatcher } from "/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2/node_modules/.pnpm/undici@7.30.1/node_modules/undici/index.js";
setGlobalDispatcher(new EnvHttpProxyAgent());
