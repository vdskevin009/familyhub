export function contrastRatio(colour, background) {
    const luminance = input => {
        const [r,g,b] = input.match(/[\d.]+/g).slice(0,3).map(n => Number(n)/255).map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4);
        return .2126*r+.7152*g+.0722*b;
    };
    const a = luminance(colour), b = luminance(background);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
