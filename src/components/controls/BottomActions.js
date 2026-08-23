import React from "react";

import SitesIcon from "../atoms/SitesIcon";
import CoverIcon from "../atoms/CoverIcon";
import InfoIcon from "../atoms/InfoIcon";

function BottomActions(props) {
  function renderToggles() {
    return (
      <>
        {props.features.USE_SITES ? (
          <div className="bottom-action-block">
            <SitesIcon
              isActive={props.sites.enabled}
              onClickHandler={props.sites.toggle}
            />
          </div>
        ) : null}
        <div className="bottom-action-block">
          <InfoIcon
            isActive={props.info.enabled}
            onClickHandler={props.info.toggle}
          />
        </div>
        {props.features.USE_COVER ? (
          <div className="bottom-action-block">
            <CoverIcon onClickHandler={props.cover.toggle} />
          </div>
        ) : null}
      </>
    );
  }

  return <div className="bottom-actions">{renderToggles()}</div>;
}

export default BottomActions;
