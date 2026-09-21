import React from "react";
import { axisBottom, timeFormat, utcFormat, select } from "d3";
import { setD3Locale } from "../../common/utilities";

const TEXT_HEIGHT = 15;
setD3Locale();
class TimelineAxis extends React.Component {
  constructor() {
    super();
    this.xAxis0Ref = React.createRef();
    this.xAxis1Ref = React.createRef();
    this.state = {
      isInitialized: false,
    };
  }

  componentDidMount() {
    this.renderAxis();
  }

  componentDidUpdate() {
    this.renderAxis();
  }

  renderAxis() {
    if (!this.props.scaleX) return;

    const { marginTop, contentHeight } = this.props.dims;
    const extent = this.props.extent; // in minutes

    // Formattatore principale per le etichette delle linee verticali (in basso)
    const formatFst = (d) => {
      // Oltre 10 anni
      if (extent > 5256000) {
        return utcFormat("%Y")(d);
      }
      // Oltre 30 giorni: mostra giorno e mese
      if (extent > 43200) {
        return utcFormat("%d %b")(d);
      }
      // Regime giornaliero (1-2 giorni): mostra che ore sono di quel giorno
      // A mezzanotte esatta (cambio di data), mostra anche giorno e mese
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
        return utcFormat("%d %b 00:00")(d);
      }
      // Nelle altre ore mostra l'orario UTC esatto (es. "02:00", "04:00", "16:00")
      return utcFormat("%H:%M")(d);
    };

    // Formattatore secondario (in alto): solo al cambio data per non sovrapporsi
    const formatSnd = (d) => {
      if (extent > 43200) {
        return "";
      }
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
        return utcFormat("%d %b")(d);
      }
      return "";
    };

    this.x0 = axisBottom(this.props.scaleX)
      .ticks(this.props.ticks)
      .tickPadding(2)
      .tickSize(contentHeight - TEXT_HEIGHT - marginTop)
      .tickFormat(formatFst);

    this.x1 = axisBottom(this.props.scaleX)
      .ticks(this.props.ticks)
      .tickPadding(marginTop)
      .tickSize(0)
      .tickFormat(formatSnd);

    if (!this.state.isInitialized) {
      this.setState({ isInitialized: true }, () => {
        select(this.xAxis0Ref.current).call(this.x0);
        select(this.xAxis1Ref.current).call(this.x1);
      });
      return;
    }

    select(this.xAxis0Ref.current)
      .transition()
      .duration(this.props.transitionDuration)
      .call(this.x0);

    select(this.xAxis1Ref.current)
      .transition()
      .duration(this.props.transitionDuration)
      .call(this.x1);
  }

  render() {
    return (
      <>
        <g
          ref={this.xAxis0Ref}
          transform={`translate(0, ${this.props.dims.marginTop})`}
          clipPath="url(#clip)"
          className="axis xAxis"
        />
        <g
          ref={this.xAxis1Ref}
          transform={`translate(0, ${this.props.dims.marginTop})`}
          clipPath="url(#clip)"
          className="axis xAxis"
        />
      </>
    );
  }
}

export default TimelineAxis;
