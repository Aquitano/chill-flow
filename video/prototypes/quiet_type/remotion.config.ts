import {Config} from "@remotion/cli/config";

Config.overrideWebpackConfig(config => ({...config, cache: false}));
