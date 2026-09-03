import React from "react";
import copy from "../../../../common/data/copy.json";
import { language } from "../../../../common/utilities";
import mapImg from "../../../../assets/satelliteoverlaytoggle/map.png";
import satImg from "../../../../assets/satelliteoverlaytoggle/sat.png";

const SatelliteOverlayToggle = ({
  // `Map.js` passes a single `toggleView` handler; the separate
  // `switchToSatellite` / `reset` props are kept for existing callers.
  toggleView,
  switchToSatellite,
  reset,
  isUsingSatellite,
}) => {
  const onSwitchToSatellite = toggleView || switchToSatellite;
  const onReset = toggleView || reset;

  return (
    <div id="satellite-overlay-toggle" className="satellite-overlay-toggle">
      {isUsingSatellite ? (
        <button
          className="satellite-overlay-toggle-button satellite-overlay-toggle-map"
          style={{ backgroundImage: `url(${mapImg}` }}
          onClick={onReset}
        >
          <div className="label">{copy[language].tiles.default}</div>
        </button>
      ) : (
        <button
          className="satellite-overlay-toggle-button satellite-overlay-toggle-sat"
          style={{ backgroundImage: `url(${satImg}` }}
          onClick={onSwitchToSatellite}
        >
          <div className="label">{copy[language].tiles.satellite}</div>
        </button>
      )}
    </div>
  );
};

export default SatelliteOverlayToggle;
