import React from "react";
import { connect } from "react-redux";
import { generateCardLayout, Card } from "./Card";
import SessionCard from "./SessionCard";

import * as selectors from "../../selectors";
import { getFilterIdxFromColorSet } from "../../common/utilities";
import copy from "../../common/data/copy.json";
import hash from "object-hash";

class CardStack extends React.Component {
  constructor() {
    super();
    this.refs = {};
    this.refCardStack = React.createRef();
    this.refCardStackContent = React.createRef();
  }

  componentDidUpdate() {
    const isNarrative = !!this.props.narrative;

    if (isNarrative) {
      this.scrollToCard();
    }
  }

  scrollToCard() {
    const duration = 500;
    const element = this.refCardStack.current;
    const cardScroll =
      this.refs[this.props.narrative.current].current.offsetTop;

    const start = element.scrollTop;
    const change = cardScroll - start;
    let currentTime = 0;
    const increment = 20;

    // t = current time
    // b = start value
    // c = change in value
    // d = duration
    Math.easeInOutQuad = function (t, b, c, d) {
      t /= d / 2;
      if (t < 1) return (c / 2) * t * t + b;
      t -= 1;
      return (-c / 2) * (t * (t - 2) - 1) + b;
    };

    const animateScroll = function () {
      currentTime += increment;
      const val = Math.easeInOutQuad(currentTime, start, change, duration);
      element.scrollTop = val;
      if (currentTime < duration) setTimeout(animateScroll, increment);
    };
    animateScroll();
  }

  renderCards(events, selections) {
    // if no selections provided, select all
    if (!selections) {
      selections = events.map((e) => true);
    }
    this.refs = [];

    const generateTemplate =
      generateCardLayout[this.props.cardUI.layout.template];

    return events.map((event, idx) => {
      const thisRef = React.createRef();
      this.refs[idx] = thisRef;

      const content = generateTemplate({
        event,
        colors: this.props.colors,
        coloringSet: this.props.coloringSet,
        getFilterIdxFromColorSet,
      });

      return (
        <Card
          key={hash(content)}
          content={content}
          language={this.props.language}
          isLoading={this.props.isLoading}
          isSelected={selections[idx]}
        />
      );
    });
  }

  renderSelectedCards() {
    const { selected } = this.props;

    if (selected.length > 0) {
      return this.renderCards(selected);
    }
    return null;
  }

  renderNarrativeCards() {
    const { narrative } = this.props;
    const showing = narrative.steps;

    const selections = showing.map((_, idx) => idx === narrative.current);

    return this.renderCards(showing, selections);
  }

  renderCardStackHeader(label) {
    const cardstackLang = copy[this.props.language].cardstack;
    const headerCopy =
      label !== undefined
        ? label
        : `${this.props.selected.length} ${cardstackLang.header}`;

    return (
      <div
        id="card-stack-header"
        className="card-stack-header"
        onClick={() => this.props.onToggleCardstack()}
      >
        <button className="side-menu-burg is-active">
          <span />
        </button>
        <p className="header-copy top">{headerCopy}</p>
      </div>
    );
  }

  renderCardStackContent() {
    return (
      <div id="card-stack-content" className="card-stack-content">
        <ul>{this.renderSelectedCards()}</ul>
      </div>
    );
  }

  renderNarrativeContent() {
    return (
      <div
        id="card-stack-content"
        className="card-stack-content"
        ref={this.refCardStackContent}
      >
        <ul>{this.renderNarrativeCards()}</ul>
      </div>
    );
  }

  render() {
    const { isCardstack, selected, narrative, features, selectedSession } =
      this.props;

    // Session-aggregated mode: one card telling the story of one attack.
    if (features.SESSION_AGGREGATION && selectedSession && !narrative) {
      const cardstackLang = copy[this.props.language].cardstack;
      return (
        <div
          id="card-stack"
          className={`card-stack session-mode ${isCardstack ? "" : " folded"}`}
        >
          {this.renderCardStackHeader(
            `${cardstackLang.session_header} · ${selectedSession.stats.eventCount} ${cardstackLang.header}`
          )}
          <div id="card-stack-content" className="card-stack-content">
            <SessionCard session={selectedSession} />
          </div>
        </div>
      );
    }

    if (selected.length > 0) {
      if (!narrative) {
        return (
          <div
            id="card-stack"
            className={`card-stack ${isCardstack ? "" : " folded"}`}
          >
            {this.renderCardStackHeader()}
            {this.renderCardStackContent()}
          </div>
        );
      } else {
        return (
          <div
            id="card-stack"
            ref={this.refCardStack}
            className={`card-stack narrative-mode
            ${isCardstack ? "" : " folded"}`}
          >
            {this.renderNarrativeContent()}
          </div>
        );
      }
    }

    return <div />;
  }
}

function mapStateToProps(state) {
  return {
    narrative: selectors.selectActiveNarrative(state),
    selectedSession: selectors.selectSelectedSession(state),
    selected: selectors.selectSelected(state),
    sourceError: state.app.errors.source,
    language: state.app.language,
    isCardstack: state.app.flags.isCardstack,
    isLoading: state.app.flags.isFetchingSources,
    cardUI: state.ui.card,
    colors: state.ui.coloring.colors,
    coloringSet: state.app.associations.coloringSet,
    features: state.features,
  };
}

export default connect(mapStateToProps)(CardStack);
