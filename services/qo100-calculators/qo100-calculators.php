<?php
/**
 * Plugin Name:       BricoHams QO-100 Calculators
 * Plugin URI:        https://github.com/BricoHams/BricoHams-QO100-Station
 * Description:       Offline calculators for QO-100 (dish gain, pointing, LNB line-up, 2.4 GHz helix, LNB LO/IF) via shortcodes.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            BricoHams
 * License:           GPL-3.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain:       bricohams-qo100
 */

defined( 'ABSPATH' ) || exit;

const BRICOHAMS_QO100_VERSION = '1.0.0';
const BRICOHAMS_QO100_HANDLE  = 'bricohams-qo100-calc';

/**
 * Calculator slug => shortcode tag.
 *
 * @return string[] Calculator slugs.
 */
function bricohams_qo100_calculators() {
	return array( 'dish', 'pointing', 'lnb', 'helix', 'ifcalc' );
}

/**
 * Translatable UI strings handed to the JS module through data-i18n.
 * Keys must match STRINGS in assets/qo100-calc.js.
 *
 * @return string[] Key => translated string.
 */
function bricohams_qo100_strings() {
	$d = 'bricohams-qo100';
	return array(
		'err_input'    => __( 'Revisa los valores: alguno no es válido o está fuera de rango.', $d ),
		'calc'         => __( 'Calcular', $d ),
		'results'      => __( 'Resultados', $d ),
		'sources'      => __( 'Fuentes de las fórmulas', $d ),
		'course'       => __( 'Curso Iniciación QO-100, EA5EN Mateo', $d ),
		'disclaimer'   => __( 'Cálculos orientativos; verifica con medidas reales.', $d ),
		'dish_title'   => __( 'Antena parabólica: ganancia y apertura', $d ),
		'dish_diam'    => __( 'Diámetro (m)', $d ),
		'dish_eta'     => __( 'Eficiencia (0-1)', $d ),
		'dish_freq'    => __( 'Frecuencia', $d ),
		'dish_f_down'  => __( '10,489 GHz (bajada)', $d ),
		'dish_f_up'    => __( '2,400 GHz (subida)', $d ),
		'dish_f_custom' => __( 'Personalizada (GHz)', $d ),
		'dish_fc'      => __( 'Frecuencia personalizada (GHz)', $d ),
		'r_gain'       => __( 'Ganancia', $d ),
		'r_bw'         => __( 'Ancho de haz a -3 dB', $d ),
		'r_lambda'     => __( 'Longitud de onda', $d ),
		'point_title'  => __( 'Apuntado de la parabólica a QO-100 (25,8° E)', $d ),
		'p_lat'        => __( 'Latitud (° N positivo)', $d ),
		'p_lon'        => __( 'Longitud (° E positivo)', $d ),
		'p_decl'       => __( 'Declinación magnética (° E positivo, la introduces tú)', $d ),
		'p_off'        => __( 'Ángulo de offset del plato (°; 0 si es simétrico)', $d ),
		'p_geo'        => __( 'Usar mi ubicación', $d ),
		'p_geo_err'    => __( 'No se pudo obtener la ubicación; introdúcela a mano.', $d ),
		'r_az_t'       => __( 'Azimut verdadero', $d ),
		'r_az_m'       => __( 'Azimut magnético', $d ),
		'r_el'         => __( 'Elevación real al satélite', $d ),
		'r_tilt'       => __( 'Inclinación del plato a ajustar (elevación - offset)', $d ),
		'r_skew'       => __( 'Skew del LNB (signo según convención del dibujo; ver README)', $d ),
		'r_range'      => __( 'Distancia al satélite', $d ),
		'r_novis'      => __( 'Atención: QO-100 no es visible desde esta posición.', $d ),
		'lnb_title'    => __( 'Línea LNB y balance de enlace', $d ),
		'l_gain'       => __( 'Ganancia de la parabólica (dBi)', $d ),
		'l_tant'       => __( 'Temperatura de antena (K)', $d ),
		'l_lnbnf'      => __( 'NF del LNB (dB)', $d ),
		'l_lnbg'       => __( 'Ganancia del LNB (dB)', $d ),
		'l_coax'       => __( 'Pérdida del coaxial (dB)', $d ),
		'l_bias'       => __( 'Pérdida del bias-T (dB)', $d ),
		'l_sdrnf'      => __( 'NF del SDR (dB)', $d ),
		'l_eirp'       => __( 'EIRP de bajada (dBW)', $d ),
		'l_eirp_note'  => __( 'Valor orientativo editable: verifica el EIRP vigente.', $d ),
		'l_range'      => __( 'Distancia al satélite (km)', $d ),
		'l_bw'         => __( 'Ancho de banda (Hz)', $d ),
		'l_atm'        => __( 'Pérdida atmosférica (dB)', $d ),
		'r_nf'         => __( 'Figura de ruido total', $d ),
		'r_tsys'       => __( 'Temperatura de sistema', $d ),
		'r_gt'         => __( 'G/T', $d ),
		'r_fspl'       => __( 'Pérdida en espacio libre', $d ),
		'r_cn0'        => __( 'C/N0', $d ),
		'r_snr'        => __( 'SNR en el ancho de banda', $d ),
		'helix_title'  => __( 'Hélice de 2,4 GHz (alimentador RHCP, Kraus)', $d ),
		'h_freq'       => __( 'Frecuencia (MHz)', $d ),
		'h_turns'      => __( 'Número de vueltas', $d ),
		'r_circ'       => __( 'Circunferencia (≈ λ)', $d ),
		'r_diam'       => __( 'Diámetro de la hélice', $d ),
		'r_pitch'      => __( 'Paso (≈ 0,25 λ)', $d ),
		'r_len'        => __( 'Longitud axial', $d ),
		'r_wire'       => __( 'Hilo total aproximado', $d ),
		'r_hgain'      => __( 'Ganancia estimada', $d ),
		'r_hpbw'       => __( 'HPBW', $d ),
		'r_gp'         => __( 'Plano de masa (mínimo 0,75 λ, recomendado ≈ 1 λ)', $d ),
		'r_z'          => __( 'Impedancia aproximada', $d ),
		'r_match'      => __( 'Banda de adaptación λ/4 (para 50 Ω)', $d ),
		'r_ar'         => __( 'Relación axial aproximada', $d ),
		'h_note'       => __( 'Conductor de cobre o latón de ~3-4 mm; alimenta en el plano de masa. Adapta los ~140 Ω a 50 Ω con una tira λ/4 de ~84 Ω que se estrecha sobre la primera media vuelta.', $d ),
		'if_title'     => __( 'LO e IF del LNB', $d ),
		'i_lo'         => __( 'LO del LNB', $d ),
		'i_lo_9750'    => __( '9750 MHz', $d ),
		'i_lo_9739'    => __( '9739 MHz', $d ),
		'i_lo_pll'     => __( 'PLL (referencia × factor)', $d ),
		'i_lo_custom'  => __( 'Personalizado (MHz)', $d ),
		'i_custom'     => __( 'LO personalizado (MHz)', $d ),
		'i_ref'        => __( 'Referencia PLL (MHz)', $d ),
		'i_mul'        => __( 'Factor PLL', $d ),
		'i_rf'         => __( 'Frecuencia de bajada RF (MHz)', $d ),
		'i_meas'       => __( 'IF medida de la baliza (MHz, opcional)', $d ),
		'i_beacon'     => __( 'Baliza de referencia (MHz)', $d ),
		'r_lo'         => __( 'LO usado', $d ),
		'r_if'         => __( 'IF de la frecuencia', $d ),
		'r_up'         => __( 'Subida correspondiente (RF - 8089,5)', $d ),
		'r_edge_lo'    => __( 'IF del borde inferior NB (10489,500)', $d ),
		'r_edge_hi'    => __( 'IF del borde superior NB (10490,000)', $d ),
		'r_beacon_if'  => __( 'IF esperada de la baliza', $d ),
		'r_actual_lo'  => __( 'LO real estimado', $d ),
		'r_drift'      => __( 'Deriva del LO', $d ),
	);
}

/**
 * Registers (does not enqueue) the assets; they load only when a shortcode runs.
 *
 * @return void
 */
function bricohams_qo100_register_assets() {
	$base = plugin_dir_url( __FILE__ ) . 'assets/';
	wp_register_style( BRICOHAMS_QO100_HANDLE, $base . 'qo100-calc.css', array(), BRICOHAMS_QO100_VERSION );
	wp_register_script( BRICOHAMS_QO100_HANDLE, $base . 'qo100-calc.js', array(), BRICOHAMS_QO100_VERSION, true );
}
add_action( 'wp_enqueue_scripts', 'bricohams_qo100_register_assets' );

/**
 * Marks our script as an ES module (it imports ./qo100-math.js).
 *
 * @param string $tag    Script tag.
 * @param string $handle Script handle.
 * @return string
 */
function bricohams_qo100_module_tag( $tag, $handle ) {
	if ( BRICOHAMS_QO100_HANDLE !== $handle ) {
		return $tag;
	}
	return str_replace( '<script ', '<script type="module" ', $tag );
}
add_filter( 'script_loader_tag', 'bricohams_qo100_module_tag', 10, 2 );

/**
 * Renders the mount point of one calculator and enqueues the assets.
 *
 * @param string $slug Calculator slug.
 * @return string HTML.
 */
function bricohams_qo100_render( $slug ) {
	if ( ! in_array( $slug, bricohams_qo100_calculators(), true ) ) {
		return '';
	}
	wp_enqueue_style( BRICOHAMS_QO100_HANDLE );
	wp_enqueue_script( BRICOHAMS_QO100_HANDLE );
	return sprintf(
		'<div class="bh-qo100" data-calc="%s" data-i18n="%s"><noscript>%s</noscript></div>',
		esc_attr( $slug ),
		esc_attr( wp_json_encode( bricohams_qo100_strings() ) ),
		esc_html__( 'Se necesita JavaScript para usar la calculadora.', 'bricohams-qo100' )
	);
}

/**
 * Shortcode handler for one calculator.
 *
 * @param string $slug Calculator slug.
 * @return callable
 */
function bricohams_qo100_shortcode_for( $slug ) {
	return function () use ( $slug ) {
		return bricohams_qo100_render( $slug );
	};
}

/**
 * Registers all shortcodes.
 *
 * @return void
 */
function bricohams_qo100_init() {
	foreach ( bricohams_qo100_calculators() as $slug ) {
		add_shortcode( 'qo100_' . $slug, bricohams_qo100_shortcode_for( $slug ) );
	}
	add_shortcode(
		'qo100_calculators',
		function () {
			$out = '';
			foreach ( bricohams_qo100_calculators() as $slug ) {
				$out .= bricohams_qo100_render( $slug );
			}
			return $out;
		}
	);
}
add_action( 'init', 'bricohams_qo100_init' );
