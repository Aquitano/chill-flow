import {Config} from "@remotion/cli/config";
Config.setPublicDir("./assets");
Config.overrideWebpackConfig(config => ({...config, cache: false}));
