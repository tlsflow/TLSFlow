import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import LocalizedImage from "./LocalizedImage.vue";
import VersionSelector from "./VersionSelector.vue";

export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component("LocalizedImage", LocalizedImage);
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () => h(VersionSelector),
      "nav-screen-content-after": () => h(VersionSelector)
    });
  }
};
