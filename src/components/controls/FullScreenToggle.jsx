import React from "react";
import screenfull from "screenfull";
import { ToolbarButton } from "./atoms/ToolbarButton";
import copy from "../../common/data/copy.json";

export class FullscreenToggle extends React.Component {
  constructor(props) {
    super(props);

    this.onFullscreenStateChange = this.onFullscreenStateChange.bind(this);

    this.state = {
      isFullscreen: screenfull.isFullscreen,
    };
  }

  componentDidMount() {
    // screenfull ships a bare stub where the API is unavailable: no `on`/`off`
    if (screenfull.isEnabled) {
      screenfull.on("change", this.onFullscreenStateChange);
    }
  }

  componentWillUnmount() {
    if (screenfull.isEnabled) {
      screenfull.off("change", this.onFullscreenStateChange);
    }
  }

  onFullscreenStateChange(evt) {
    this.setState({ isFullscreen: screenfull.isFullscreen });
  }

  onToggleFullscreen() {
    screenfull.toggle().catch(console.warn);
  }

  render() {
    if (!screenfull.isEnabled) return null;

    const { language } = this.props;
    const { isFullscreen } = this.state;

    return (
      <ToolbarButton
        isActive={isFullscreen}
        label={
          isFullscreen
            ? copy[language].toolbar.fullscreen_exit
            : copy[language].toolbar.fullscreen_enter
        }
        iconKey={isFullscreen ? "fullscreen_exit" : "fullscreen"}
        onClick={this.onToggleFullscreen}
      />
    );
  }
}
