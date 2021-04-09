// taken from https://stackoverflow.com/questions/64425555/is-it-possible-to-detect-if-docusaurus-is-in-light-or-dark-mode

import React from 'react';
import useThemeContext from '@theme/hooks/useThemeContext';

const ImageSwitcher = ({ lightImageSrc, darkImageSrc }) => {
    const { isDarkTheme } = useThemeContext();

    return (
        <img src={isDarkTheme ? darkImageSrc : lightImageSrc} />
    );
};

export default ImageSwitcher;
